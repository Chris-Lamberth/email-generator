const express = require('express');
const multer = require('multer');
const ejs = require('ejs');
const fs = require('fs').promises;
const path = require('path');
const os = require('os');
const archiver = require('archiver'); 
const sharp = require('sharp');

const app = express();
const port = process.env.PORT || 3000;

// Utility functions
function replacePlaceholders(input, brandName) {
    return input.replace(/\[Brand\]/g, brandName);
}

async function getBrandObjectNameFromName(jsonData, brandName) {
    for (let category of ['service', 'tire']) {
        for (let brandObject in jsonData[category]) {
            if (jsonData[category][brandObject].name === brandName) {
                return brandObject;
            }
        }
    }
    return null;
}

async function getImageDimensions(filePath) {
    const metadata = await sharp(filePath).metadata();
    return {
        width: Math.round(metadata.width / 2),
        height: Math.round(metadata.height / 2)
    };
}

// Middleware configuration
app.set('view engine', 'ejs');
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static('public'));

const storage = multer.diskStorage({
	destination: os.tmpdir(),
	filename: (req, file, cb) => {
		 const brandName = file.fieldname.split('Coupons')[0];
		 const timeStamp = new Date().toISOString().replace(/[:.-]/g, '');
		 cb(null, `${brandName}-${file.fieldname}-${file.originalname}-${timeStamp}${path.extname(file.originalname)}`);
	}
});

const upload = multer({ 
    storage, 
    fileFilter: (req, file, cb) => {
        cb(null, file.mimetype === 'image/jpeg');
    }
});

// Routes
app.get('/', async (req, res) => {
    const jsonData = JSON.parse(await fs.readFile('data.json', 'utf8'));
    const serviceBrands = Object.values(jsonData.service).map(brand => brand.name);
    const tireBrands = Object.values(jsonData.tire).map(brand => brand.name);
    res.render('form_page', { serviceBrands, tireBrands });
});

app.post('/generate-emails', upload.fields([{ name: 'serviceHeaderImage', maxCount: 1 }, { name: 'tireHeaderImage', maxCount: 1 }, { name: 'directory', maxCount: 100 }]), async (req, res) => {
    const jsonData = JSON.parse(await fs.readFile('data.json', 'utf8'));
    const archive = archiver('zip');
    const tmpDirs = [];

    for (let category of ['service', 'tire']) {
        for (let brand of Object.values(jsonData[category])) {
            const brandObjectName = await getBrandObjectNameFromName(jsonData, brand.name);
            if (!brandObjectName) {
                console.error(`No object name found for brand: ${brand.name}`);
                continue;
            }

            const brandData = jsonData[category][brandObjectName];
            const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), `${category}-${brandObjectName}-`));
            tmpDirs.push(tmpDir);

            const imagePath = path.join(tmpDir, 'images');
            await fs.mkdir(imagePath);

            await fs.copyFile(brandData.logoURL, path.join(imagePath, 'logo.jpg'));
            await fs.copyFile(req.files[`${category}HeaderImage`][0].path, path.join(imagePath, 'header.jpg'));

            if (brandData.footerGraphic) {
                const footerGraphicFileName = path.basename(brandData.footerGraphic);
                await fs.copyFile(brandData.footerGraphic, path.join(imagePath, footerGraphicFileName));
                brandData.footerGraphic = path.join('images', footerGraphicFileName);
            }

            const couponNumbers = req.body[`${brand.name}Coupons`].split(',').map(num => num.trim());
				const couponFiles = couponNumbers.map(num => {
					const pattern = new RegExp(`^${num}_[a-zA-Z0-9]+`);
					const matches = req.files['directory'].filter(file => pattern.test(file.originalname));
					
					if (matches.length > 1) {
						  console.warn(`Multiple matches for coupon number ${num}: ${matches.map(m => m.originalname).join(', ')}`);
					} else if (matches.length === 0) {
						  console.warn(`No match found for coupon number ${num}`);
					}
				 
					return matches[0]; // returns the first match or undefined if no match
			  });
			  
            const couponDimensions = {};
            for (let file of couponFiles) {
                await fs.copyFile(file.path, path.join(imagePath, file.originalname));
                couponDimensions[file.originalname] = await getImageDimensions(path.join(imagePath, file.originalname));
            }

            const couponPaths = couponFiles.map(file => ({
                path: path.join('images', file.originalname),
                dimensions: couponDimensions[file.originalname]
            }));

            const emailContent = await ejs.renderFile('./views/email_template.ejs', {
                title: replacePlaceholders(req.body[`${category}Title`], brandData.name),
                bodyCopy: replacePlaceholders(req.body[`${category}BodyCopy`], brandData.name),
                logoURL: path.join('images', 'logo.jpg'),
                headerImage: path.join('images', 'header.jpg'),
                colors: brandData.colors,
                headerLinks: brandData.headerLinks,
                footerLinks: brandData.footerLinks,
                phone: brandData.phone,
                name: brandData.name,
                coupons: couponPaths,
                notification: brandData.notification,
                footerGraphic: brandData.footerGraphic,
					 disclaimer: brandData.disclaimer
            });

            await fs.writeFile(path.join(tmpDir, 'index.html'), emailContent);
            archive.directory(tmpDir, `${category}/${brandObjectName}`);
        }
    }

    archive.finalize();
    res.attachment('emails.zip');
    archive.pipe(res);

    res.on('finish', async () => {
        for (let dir of tmpDirs) {
            await fs.rm(dir, { recursive: true });
        }
    });
});

app.listen(port, () => {
    console.log(`Email Generator is now running on http://localhost:${port}`);
});
