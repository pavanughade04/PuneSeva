const crypto = require('crypto');
const fs = require('fs/promises');
const path = require('path');
const multer = require('multer');

const uploadDirectory = path.resolve(__dirname, '..', 'uploads');
const imageTypes = new Map([
  ['image/jpeg', { extension: '.jpg', signature: (buffer) => buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff }],
  ['image/png', { extension: '.png', signature: (buffer) => buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) }],
  ['image/webp', { extension: '.webp', signature: (buffer) => buffer.length >= 12 && buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP' }]
]);

const receiveImage = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024, files: 1 },
  fileFilter(req, file, callback) {
    if (!imageTypes.has(file.mimetype)) {
      const error = new Error('Choose a JPEG, PNG, or WebP image.');
      error.status = 400;
      return callback(error);
    }
    callback(null, true);
  }
}).single('image');

async function removeServiceImage(filename) {
  if (!filename || !/^[0-9a-f-]{36}\.(jpg|png|webp)$/.test(filename)) return;
  try {
    await fs.unlink(path.join(uploadDirectory, filename));
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
}

function uploadServiceImage(req, res, next) {
  receiveImage(req, res, async (uploadError) => {
    if (uploadError) {
      const status = uploadError.code === 'LIMIT_FILE_SIZE' ? 413 : uploadError.status || 400;
      return res.status(status).json({
        error: uploadError.code === 'LIMIT_FILE_SIZE'
          ? 'Images must be 5 MB or smaller.'
          : uploadError.message
      });
    }
    if (!req.file) return next();

    const type = imageTypes.get(req.file.mimetype);
    if (!type.signature(req.file.buffer)) {
      return res.status(400).json({ error: 'The uploaded file is not a valid JPEG, PNG, or WebP image.' });
    }

    const filename = `${crypto.randomUUID()}${type.extension}`;
    try {
      await fs.mkdir(uploadDirectory, { recursive: true });
      await fs.writeFile(path.join(uploadDirectory, filename), req.file.buffer, { flag: 'wx' });
      req.file.filename = filename;
      req.file.imageUrl = `/uploads/${filename}`;
      next();
    } catch (error) {
      next(error);
    }
  });
}

module.exports = { removeServiceImage, uploadServiceImage };
