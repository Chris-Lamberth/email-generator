const express = require('express');
const bodyParser = require('body-parser');
const multer = require('multer');
const ejs = require('ejs');
const fs = require('fs');
const path = require('path');
const os = require('os');
const archiver = require('archiver'); 

const app = express();
const port = 3000;

// Function to replace placeholders
function replacePlaceholders(input, brandName) {
    return input.replace(/\[Brand\]/g, brandName);
}

// Setting up EJS
app.set('view engine', 'ejs');

// Middleware for body parser
app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());

// Use public folder for static files
app.use(express.static('public'));

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, os.tmpdir());  // save to system temp directory
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
 

app.post('/generate-emails', upload.fields([{ name: 'serviceHeaderImage', maxCount: 1 }, { name: 'tireHeaderImage', maxCount: 1 }]), async (req, res) => {
  const jsonData = JSON.parse(fs.readFileSync('data.json', 'utf8'));
  const archive = archiver('zip');
  const tmpDirs = [];

  for (let category of ['service', 'tire']) {
    for (let brand in jsonData[category]) {
      const brandData = jsonData[category][brand];
      const tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), `${category}-${brand}-`));
      tmpDirs.push(tmpDir);

      const imagePath = path.join(tmpDir, 'images');
      await fs.promises.mkdir(imagePath);

      // Copy logo and header images to the images folder
      await fs.promises.copyFile(brandData.logoURL, path.join(imagePath, 'logo.jpg'));
      await fs.promises.copyFile(req.files[`${category}HeaderImage`][0].path, path.join(imagePath, 'header.jpg'));

      const emailContent = await ejs.renderFile('./views/email_template.ejs', {
        title: replacePlaceholders(req.body[`${category}Title`], brandData.name),
        bodyCopy: replacePlaceholders(req.body[`${category}BodyCopy`], brandData.name),
        logoURL: path.join('images', 'logo.jpg'),
        headerImage: path.join('images', 'header.jpg'),
        colors: brandData.colors,
        headerLinks: brandData.headerLinks,
        footerLinks: brandData.footerLinks,
        phone: brandData.phone,
        name: brandData.name
      });

      fs.writeFileSync(path.join(tmpDir, 'index.html'), emailContent);
      archive.directory(tmpDir, `${category}/${brand}`);
    }
  }

  archive.finalize();

  // Send the ZIP file as a response
  res.attachment('emails.zip');
  archive.pipe(res);

  // Once the ZIP is sent to the client, remove the temporary directories
  res.on('finish', () => {
    for (let dir of tmpDirs) {
      fs.promises.rm(dir, { recursive: true });
    }
  });
});

app.listen(port, () => {
  console.log(`Email Generator is now running on http://localhost:${port}`);
});
