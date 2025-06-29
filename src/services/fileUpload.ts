import AWS from 'aws-sdk';
import multer from 'multer';
import path from 'path';

// Configure AWS SDK for Cloudflare R2
const s3 = new AWS.S3({
  endpoint: process.env.CLOUDFLARE_R2_ENDPOINT,
  accessKeyId: process.env.CLOUDFLARE_R2_ACCESS_KEY_ID,
  secretAccessKey: process.env.CLOUDFLARE_R2_SECRET_ACCESS_KEY,
  region: 'auto',
  signatureVersion: 'v4',
});

const BUCKET_NAME = process.env.CLOUDFLARE_R2_BUCKET_NAME || 'hungy-documents';

// Configure multer for memory storage
export const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB limit
  },
  fileFilter: (req, file, cb) => {
    // Allow common document types
    const allowedTypes = [
      'application/pdf',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'text/plain',
      'image/jpeg',
      'image/png',
      'image/gif'
    ];
    
    if (allowedTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Invalid file type. Only PDF, Word, text, and image files are allowed.'));
    }
  }
});

// Upload file to Cloudflare R2
export const uploadToR2 = async (
  file: Express.Multer.File,
  organizationId: number,
  folder: string = 'terms-and-conditions'
): Promise<{ fileUrl: string; fileName: string; fileSize: number }> => {
  try {
    // Check if R2 is configured
    if (!process.env.CLOUDFLARE_R2_ENDPOINT || !process.env.CLOUDFLARE_R2_ACCESS_KEY_ID || !process.env.CLOUDFLARE_R2_SECRET_ACCESS_KEY) {
      throw new Error('Cloudflare R2 not configured. Please add R2 environment variables to .env file.');
    }

    // Generate unique filename
    const timestamp = Date.now();
    const extension = path.extname(file.originalname);
    const fileName = `${folder}/${organizationId}/${timestamp}-${file.originalname}`;

    const uploadParams = {
      Bucket: BUCKET_NAME,
      Key: fileName,
      Body: file.buffer,
      ContentType: file.mimetype,
      ACL: 'public-read', // Make file publicly accessible
    };

    const result = await s3.upload(uploadParams).promise();
    console.log(`Successfully uploaded file to R2: ${fileName}`);
    console.log(`File URL generated: ${result.Location}`);
    
    return {
      fileUrl: result.Location,
      fileName: file.originalname,
      fileSize: file.size
    };
  } catch (error) {
    console.error('Error uploading to R2:', error);
    throw new Error('Failed to upload file to cloud storage');
  }
};

// Delete file from Cloudflare R2
export const deleteFromR2 = async (fileUrl: string): Promise<void> => {
  try {
    // Check if R2 is configured
    if (!process.env.CLOUDFLARE_R2_ENDPOINT || !process.env.CLOUDFLARE_R2_ACCESS_KEY_ID || !process.env.CLOUDFLARE_R2_SECRET_ACCESS_KEY) {
      console.warn('Cloudflare R2 not configured. Skipping file deletion from cloud storage.');
      return;
    }

    console.log('Attempting to delete file from R2:', fileUrl);

    // Extract key from URL - handle different URL formats
    let key: string;
    
    try {
      const url = new URL(fileUrl);
      // Remove leading slash and decode any URL encoding
      key = decodeURIComponent(url.pathname.substring(1));
      
      // Handle case where the URL might have bucket name in path
      // R2 URLs can be: https://bucket.accountid.r2.cloudflarestorage.com/path/to/file
      // or: https://accountid.r2.cloudflarestorage.com/bucket/path/to/file
      if (key.startsWith(BUCKET_NAME + '/')) {
        key = key.substring(BUCKET_NAME.length + 1);
      }
      
      console.log('Extracted key for deletion:', key);
    } catch (urlError) {
      console.error('Error parsing file URL:', urlError);
      throw new Error('Invalid file URL format');
    }

    const deleteParams = {
      Bucket: BUCKET_NAME,
      Key: key
    };

    console.log('Delete parameters:', deleteParams);

    const result = await s3.deleteObject(deleteParams).promise();
    console.log(`Successfully deleted file from R2:`, result);
    console.log(`File key deleted: ${key}`);
  } catch (error: any) {
    console.error('Error deleting from R2:', error);
    console.error('Error details:', {
      message: error?.message,
      code: error?.code,
      statusCode: error?.statusCode
    });
    throw new Error(`Failed to delete file from cloud storage: ${error?.message || 'Unknown error'}`);
  }
};

// Generate signed URL for temporary access (if needed)
export const generateSignedUrl = async (fileUrl: string, expiresIn: number = 3600): Promise<string> => {
  try {
    const url = new URL(fileUrl);
    const key = url.pathname.substring(1);

    const signedUrl = s3.getSignedUrl('getObject', {
      Bucket: BUCKET_NAME,
      Key: key,
      Expires: expiresIn
    });

    return signedUrl;
  } catch (error) {
    console.error('Error generating signed URL:', error);
    throw new Error('Failed to generate file access URL');
  }
}; 