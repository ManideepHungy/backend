import AWS from 'aws-sdk';
import multer from 'multer';
import path from 'path';

// Function to get the correct bucket name based on folder type
export const getBucketName = (folder: string): string => {
  switch (folder) {
    case 'useragreements':
      return process.env.CLOUDFLARE_R2_BUCKET_NAME_2 || process.env.CLOUDFLARE_R2_BUCKET_NAME || 'hungy-documents';
    case 'terms-and-conditions':
    default:
      return process.env.CLOUDFLARE_R2_BUCKET_NAME || 'hungy-documents';
  }
};

// Function to get the correct endpoint
const getEndpoint = (): string => {
  const endpoint = process.env.CLOUDFLARE_R2_ENDPOINT;
  if (!endpoint) {
    throw new Error('CLOUDFLARE_R2_ENDPOINT not configured');
  }
  
  // Clean up endpoint if it contains bucket name
  const bucketName = process.env.CLOUDFLARE_R2_BUCKET_NAME;
  if (bucketName && endpoint.endsWith('/' + bucketName)) {
    const cleanedEndpoint = endpoint.replace('/' + bucketName, '');
    console.log('⚠️  Cleaned endpoint from', endpoint, 'to', cleanedEndpoint);
    return cleanedEndpoint;
  }
  
  // Validate endpoint format
  if (!endpoint.startsWith('https://') || !endpoint.includes('.r2.cloudflarestorage.com')) {
    console.warn('⚠️  Endpoint format may be incorrect:', endpoint);
  }
  
  return endpoint;
};

// Configure AWS SDK for Cloudflare R2
export const createS3Client = () => {
  try {
    const endpoint = getEndpoint();
    const accessKeyId = process.env.CLOUDFLARE_R2_ACCESS_KEY_ID;
    const secretAccessKey = process.env.CLOUDFLARE_R2_SECRET_ACCESS_KEY;
    
    console.log('Creating S3 client with config:', {
      endpoint,
      hasAccessKey: !!accessKeyId,
      hasSecretKey: !!secretAccessKey,
      region: 'auto'
    });
    
    return new AWS.S3({
      endpoint: endpoint,
      accessKeyId: accessKeyId,
      secretAccessKey: secretAccessKey,
      region: 'auto',
      signatureVersion: 'v4',
      s3ForcePathStyle: true, // Required for R2
      maxRetries: 3,
      httpOptions: {
        timeout: 30000, // 30 seconds
        connectTimeout: 10000 // 10 seconds
      }
    });
  } catch (error) {
    console.error('Error creating S3 client:', error);
    throw error;
  }
};

// Initialize configuration on startup
try {
  console.log('R2 Configuration initialized:', {
    endpoint: getEndpoint(),
    termsAndConditionsBucket: getBucketName('terms-and-conditions'),
    userAgreementsBucket: getBucketName('useragreements'),
    termsPublicDomain: process.env.CLOUDFLARE_R2_PUBLIC_DOMAIN_TERMS || 'https://pub-c857040dd8b04257a9c8881a70d5759a.r2.dev',
    userAgreementsPublicDomain: process.env.CLOUDFLARE_R2_PUBLIC_DOMAIN_USERAGREEMENTS || 'https://pub-f419c4a70b0e43678d4b60ea2eac8295.r2.dev',
    hasAccessKey: !!process.env.CLOUDFLARE_R2_ACCESS_KEY_ID,
    hasSecretKey: !!process.env.CLOUDFLARE_R2_SECRET_ACCESS_KEY
  });
} catch (initError) {
  console.error('❌ R2 Configuration Error:', initError);
  console.error('Please check your R2 environment variables');
}

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
    console.log('Starting R2 upload process...');
    console.log('Upload parameters:', {
      folder,
      organizationId,
      fileName: file.originalname,
      fileSize: file.size,
      mimeType: file.mimetype
    });

    // Check if R2 is configured
    if (!process.env.CLOUDFLARE_R2_ENDPOINT || !process.env.CLOUDFLARE_R2_ACCESS_KEY_ID || !process.env.CLOUDFLARE_R2_SECRET_ACCESS_KEY) {
      console.error('R2 configuration missing:', {
        endpoint: !!process.env.CLOUDFLARE_R2_ENDPOINT,
        accessKey: !!process.env.CLOUDFLARE_R2_ACCESS_KEY_ID,
        secretKey: !!process.env.CLOUDFLARE_R2_SECRET_ACCESS_KEY
      });
      throw new Error('Cloudflare R2 not configured. Please add R2 environment variables to .env file.');
    }

    // Get the appropriate bucket name for this folder
    const bucketName = getBucketName(folder);
    console.log('Using R2 bucket:', bucketName);

    // Create S3 client
    const s3 = createS3Client();

    // Test bucket access before uploading
    try {
      console.log('Testing bucket access...');
      await s3.headBucket({ Bucket: bucketName }).promise();
      console.log('Bucket access confirmed');
    } catch (bucketError) {
      console.error('Bucket access test failed:', bucketError);
      if (bucketError instanceof Error) {
        if (bucketError.message.includes('AccessDenied') || bucketError.message.includes('403')) {
          throw new Error('Permission denied. Please check R2 bucket permissions and credentials.');
        } else if (bucketError.message.includes('NoSuchBucket') || bucketError.message.includes('404')) {
          throw new Error('Storage bucket not found. Please contact administrator.');
        } else if (bucketError.message.includes('InvalidAccessKeyId')) {
          throw new Error('Invalid R2 access key. Please check your credentials.');
        } else if (bucketError.message.includes('SignatureDoesNotMatch')) {
          throw new Error('Invalid R2 secret key. Please check your credentials.');
        } else {
          throw new Error(`Bucket access failed: ${bucketError.message}`);
        }
      }
      throw bucketError;
    }

    // Generate unique filename
    const timestamp = Date.now();
    const extension = path.extname(file.originalname);
    const fileName = `${folder}/${organizationId}/${timestamp}-${file.originalname}`;

    console.log('Generated file path:', fileName);

    const uploadParams = {
      Bucket: bucketName,
      Key: fileName,
      Body: file.buffer,
      ContentType: file.mimetype,
      // Note: R2 doesn't support ACL in the same way as S3
      // We need to make sure the bucket has public access configured
    };

    console.log('Attempting upload to R2 with params:', {
      Bucket: bucketName,
      Key: fileName,
      ContentType: file.mimetype,
      BodyLength: file.buffer?.length
    });

    const result = await s3.upload(uploadParams).promise();
    console.log(`Successfully uploaded file to R2: ${fileName}`);
    console.log(`File URL generated: ${result.Location}`);
    
    // Construct the public URL for R2
    let publicUrl = result.Location;
    
    console.log('Original R2 URL:', publicUrl);
    console.log('Bucket:', bucketName, 'Key:', fileName);
    
    // Use the appropriate public domain based on the folder type
    let publicDomain;
    if (folder === 'useragreements') {
      publicDomain = process.env.CLOUDFLARE_R2_PUBLIC_DOMAIN_USERAGREEMENTS || 'https://pub-f419c4a70b0e43678d4b60ea2eac8295.r2.dev';
    } else {
      publicDomain = process.env.CLOUDFLARE_R2_PUBLIC_DOMAIN_TERMS || 'https://pub-c857040dd8b04257a9c8881a70d5759a.r2.dev';
    }
    
    // Construct the public URL
    publicUrl = `${publicDomain}/${fileName}`;
    console.log('Using public domain URL:', publicUrl);
    
    return {
      fileUrl: publicUrl,
      fileName: file.originalname,
      fileSize: file.size
    };
  } catch (error) {
    console.error('Error uploading to R2:', error);
    console.error('Error details:', {
      message: error instanceof Error ? error.message : 'Unknown error',
      stack: error instanceof Error ? error.stack : undefined,
      code: (error as any)?.code,
      statusCode: (error as any)?.statusCode,
      requestId: (error as any)?.requestId,
      cfId: (error as any)?.cfId
    });
    
    // Provide more specific error messages
    let errorMessage = 'Failed to upload file to cloud storage';
    if (error instanceof Error) {
      if (error.message.includes('not configured')) {
        errorMessage = 'File upload service not configured. Please contact administrator.';
      } else if (error.message.includes('network') || error.message.includes('connection')) {
        errorMessage = 'Network error. Please check your connection and try again.';
      } else if (error.message.includes('permission') || error.message.includes('access') || error.message.includes('AccessDenied')) {
        errorMessage = 'Permission denied. Please check R2 bucket permissions and credentials.';
      } else if (error.message.includes('bucket') || error.message.includes('not found') || error.message.includes('NoSuchBucket')) {
        errorMessage = 'Storage bucket not found. Please contact administrator.';
      } else if (error.message.includes('credentials') || error.message.includes('authentication') || error.message.includes('InvalidAccessKeyId')) {
        errorMessage = 'Authentication failed. Please check R2 credentials.';
      } else if (error.message.includes('InvalidRequest') || error.message.includes('MalformedXML')) {
        errorMessage = 'Invalid request format. Please try again.';
      } else if (error.message.includes('SignatureDoesNotMatch')) {
        errorMessage = 'Invalid R2 secret key. Please check your credentials.';
      } else {
        errorMessage = error.message;
      }
    }
    
    throw new Error(errorMessage);
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
    let bucketName: string;
    
    try {
      const url = new URL(fileUrl);
      // Remove leading slash and decode any URL encoding
      key = decodeURIComponent(url.pathname.substring(1));
      
      // Determine bucket name from the key path
      if (key.startsWith('useragreements/')) {
        bucketName = getBucketName('useragreements');
      } else if (key.startsWith('terms-and-conditions/')) {
        bucketName = getBucketName('terms-and-conditions');
      } else {
        // Default to terms and conditions bucket
        bucketName = getBucketName('terms-and-conditions');
      }
      
      // Handle case where the URL might have bucket name in path
      // R2 URLs can be: https://bucket.accountid.r2.cloudflarestorage.com/path/to/file
      // or: https://accountid.r2.cloudflarestorage.com/bucket/path/to/file
      if (key.startsWith(bucketName + '/')) {
        key = key.substring(bucketName.length + 1);
      }
      
      console.log('Extracted key for deletion:', key);
      console.log('Using bucket:', bucketName);
    } catch (urlError) {
      console.error('Error parsing file URL:', urlError);
      throw new Error('Invalid file URL format');
    }

    // Create S3 client
    const s3 = createS3Client();

    const deleteParams = {
      Bucket: bucketName,
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

    // Determine bucket name from the key path
    let bucketName: string;
    if (key.startsWith('useragreements/')) {
      bucketName = getBucketName('useragreements');
    } else if (key.startsWith('terms-and-conditions/')) {
      bucketName = getBucketName('terms-and-conditions');
    } else {
      // Default to terms and conditions bucket
      bucketName = getBucketName('terms-and-conditions');
    }

    // Create S3 client
    const s3 = createS3Client();

    const signedUrl = s3.getSignedUrl('getObject', {
      Bucket: bucketName,
      Key: key,
      Expires: expiresIn
    });

    return signedUrl;
  } catch (error) {
    console.error('Error generating signed URL:', error);
    throw new Error('Failed to generate file access URL');
  }
}; 