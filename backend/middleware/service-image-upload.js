
const crypto = require('crypto');
const { Readable } = require('stream');
const multer = require('multer');

const cloudinary = require('../config/cloudinary');

const imageTypes = new Map([
  ['image/jpeg', {
    extension: '.jpg',
    signature: (buffer) =>
      buffer.length >= 3 &&
      buffer[0] === 0xff &&
      buffer[1] === 0xd8 &&
      buffer[2] === 0xff
  }],
  ['image/png', {
    extension: '.png',
    signature: (buffer) =>
      buffer.length >= 8 &&
      buffer.subarray(0, 8).equals(
        Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
      )
  }],
  ['image/webp', {
    extension: '.webp',
    signature: (buffer) =>
      buffer.length >= 12 &&
      buffer.toString('ascii', 0, 4) === 'RIFF' &&
      buffer.toString('ascii', 8, 12) === 'WEBP'
  }]
]);

const receiveImage = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 5 * 1024 * 1024,
    files: 1
  },
  fileFilter(req, file, callback) {
    if (!imageTypes.has(file.mimetype)) {
      const error = new Error('Choose a JPEG, PNG, or WebP image.');
      error.status = 400;
      return callback(error);
    }

    callback(null, true);
  }
}).single('image');

function uploadToCloudinary(buffer, publicId) {
  return new Promise((resolve, reject) => {
    const uploadStream = cloudinary.uploader.upload_stream(
      {
        public_id: publicId,
        resource_type: 'image',
        overwrite: false
      },
      (error, result) => {
        if (error) return reject(error);
        resolve(result);
      }
    );

    uploadStream.on('error', reject);
    Readable.from(buffer).pipe(uploadStream);
  });
}

async function removeServiceImage(filename) {
  if (!filename || typeof filename !== 'string') return;

  const safeFilename = filename.split('/').pop();

  if (!/^[0-9a-f-]{36}\.(jpg|png|webp)$/.test(safeFilename)) {
    return;
  }

  const publicId = safeFilename.replace(/\.(jpg|png|webp)$/, '');

  const result = await cloudinary.uploader.destroy(publicId, {
    resource_type: 'image'
  });

  if (result.result !== 'ok' && result.result !== 'not found') {
    throw new Error('Could not remove service image from Cloudinary.');
  }
}

function uploadServiceImage(req, res, next) {
  receiveImage(req, res, async (uploadError) => {
    if (uploadError) {
      const status =
        uploadError.code === 'LIMIT_FILE_SIZE'
          ? 413
          : uploadError.status || 400;

      return res.status(status).json({
        error:
          uploadError.code === 'LIMIT_FILE_SIZE'
            ? 'Images must be 5 MB or smaller.'
            : uploadError.message
      });
    }

    if (!req.file) return next();

    const type = imageTypes.get(req.file.mimetype);

    if (!type.signature(req.file.buffer)) {
      return res.status(400).json({
        error: 'The uploaded file is not a valid JPEG, PNG, or WebP image.'
      });
    }

    const filename = `${crypto.randomUUID()}${type.extension}`;
    const publicId = filename.replace(/\.(jpg|png|webp)$/, '');

    try {
      const result = await uploadToCloudinary(req.file.buffer, publicId);

      req.file.filename = filename;
      req.file.imageUrl = result.secure_url;

      next();
    } catch (error) {
      const responseBody = error.response?.body;

      let responseMessage =
        error.error?.message ||
        responseBody?.error?.message ||
        responseBody?.message ||
        null;

      if (!responseMessage && typeof responseBody === 'string') {
        try {
          const parsed = JSON.parse(responseBody);
          responseMessage =
            parsed.error?.message || parsed.message || null;
        } catch {
          responseMessage = null;
        }
      }

      console.error('Cloudinary upload diagnostic:', {
        httpStatus: error.http_code || error.response?.statusCode || null,
        errorName: error.name || null,
        message: error.message || null,
        cloudinaryMessage: responseMessage,
        errorProperties: Object.keys(error)
      });

      next(error);
    }
  });
}

module.exports = {
  removeServiceImage,
  uploadServiceImage
};
