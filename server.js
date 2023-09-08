const express = require('express');
const bodyParser = require('body-parser');
const multer = require('multer');
const ejs = require('ejs');
const fs = require('fs');
const path = require('path');
const os = require('os');
const archiver = require('archiver'); 
const sharp = require('sharp');

const app = express();
const port = 3000;

function replacePlaceholders(input, brandName) {
    return input.replace(/\[Brand\]/g, brandName);
}

function getBrandObjectNameFromName(jsonData, brandName) {
    for (let category of ['service', 'tire']) {
        for (let brandObject in jsonData[category]) {
            if (jsonData[category][brandObject].name === brandName) {
                return brandObject;
            }
        }
    }
    return null;
}

function getAltTextFromFileName(fileName) {
    return fileName.replace(/^\d+_/, '').replace(/\.jpg$/, '').replace(/_/g, ' ').trim();
}

async function getImageDimensions(filePath) {
    const metadata = await sharp(filePath).metadata();
    return {
        width: Math.round(metadata.width / 2),
        height: Math.round(metadata.height / 2)
    };
}

app.set('view engine', 'ejs');
app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());
app.use(express.static('public'));

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, os.tmpdir());
  },
  filename: (req, file, cb) => {
    cb(null, file.fieldname + '-' + Date.now() + path.extname(file.originalname));
  }
});

const fileFilter = (req, file, cb) => {
  if (file.mimetype === 'image/jpeg') {
    cb(null, true);
  } else {
    cb(new Error('Only .jpg files are allowed!'), false);
  }
};

const upload = multer({ storage: storage, fileFilter: fileFilter });

app.get('/', (req, res) => {
    const jsonData = JSON.parse(fs.readFileSync('data.json', 'utf8'));
    const serviceBrands = Object.values(jsonData.service).map(brand => brand.name);
    const tireBrands = Object.values(jsonData.tire).map(brand => brand.name);
    res.render('form_page', { serviceBrands, tireBrands });
});

app.post('/generate-emails', upload.fields([{ name: 'serviceHeaderImage', maxCount: 1 }, { name: 'tireHeaderImage', maxCount: 1 }, { name: 'directory', maxCount: 100 }]), async (req, res) => {
    const jsonData = JSON.parse(fs.readFileSync('data.json', 'utf8'));
    const archive = archiver('zip');
    const tmpDirs = [];

    for (let category of ['service', 'tire']) {
        for (let brand of Object.values(jsonData[category])) {
            const brandObjectName = getBrandObjectNameFromName(jsonData, brand.name);
            if (!brandObjectName) {
                console.error(`No object name found for brand: ${brand.name}`);
                continue;
            }

            const brandData = jsonData[category][brandObjectName];
            const tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), `${category}-${brandObjectName}-`));
            tmpDirs.push(tmpDir);

            const imagePath = path.join(tmpDir, 'images');
            await fs.promises.mkdir(imagePath);

            await fs.promises.copyFile(brandData.logoURL, path.join(imagePath, 'logo.jpg'));
            await fs.promises.copyFile(req.files[`${category}HeaderImage`][0].path, path.join(imagePath, 'header.jpg'));

            const couponNumbers = req.body[`${brand.name}Coupons`].split(',').map(num => num.trim());
            const couponFiles = req.files['directory'].filter(file => couponNumbers.includes(file.originalname.split('_')[0]));
            
            const couponDimensions = {};
            for (let file of couponFiles) {
                await fs.promises.copyFile(file.path, path.join(imagePath, file.originalname));
                couponDimensions[file.originalname] = await getImageDimensions(path.join(imagePath, file.originalname));
            }

            const couponPaths = couponFiles.map(file => ({
                path: path.join('images', file.originalname),
                dimensions: couponDimensions[file.originalname],
                alt: getAltTextFromFileName(file.originalname)
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
					 notification: brandData.notification,
                name: brandData.name,
                coupons: couponPaths
            });

            fs.writeFileSync(path.join(tmpDir, 'index.html'), emailContent);
            archive.directory(tmpDir, `${category}/${brandObjectName}`);
        }
    }

    archive.finalize();
    res.attachment('emails.zip');
    archive.pipe(res);

    res.on('finish', () => {
        for (let dir of tmpDirs) {
            fs.promises.rm(dir, { recursive: true });
        }
    });
});

app.listen(port, () => {
    console.log(`Email Generator is now running on http://localhost:${port}`);
});
