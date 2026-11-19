require('dotenv').config({
  path: require('path').join(__dirname, '.env')
});

const cloudinary = require('./config/cloudinary');

async function testConnection() {
  try {
    const result = await cloudinary.api.ping();
    console.log('Cloudinary connection successful!');
    console.log(result);
  } catch (error) {
    console.error('Cloudinary connection failed:');
    console.error(error.message);
  }
}

testConnection();
