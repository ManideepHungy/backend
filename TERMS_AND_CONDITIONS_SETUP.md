# Terms and Conditions Setup Guide

## Overview
This feature allows organizations to upload and manage Terms and Conditions documents with files stored in Cloudflare R2.

## Features
- Upload documents (PDF, Word, Text, Images)
- CRUD operations for Terms and Conditions
- File storage in Cloudflare R2
- Version management
- Active/Inactive status
- File replacement
- View files in new tab

## Backend Setup

### 1. Environment Variables
Add these variables to your `.env` file:

```env
# Cloudflare R2 Configuration
CLOUDFLARE_R2_ENDPOINT="https://your-account-id.r2.cloudflarestorage.com"
CLOUDFLARE_R2_ACCESS_KEY_ID="your-r2-access-key-id"
CLOUDFLARE_R2_SECRET_ACCESS_KEY="your-r2-secret-access-key"
CLOUDFLARE_R2_BUCKET_NAME="hungy-documents"
```

### 2. Cloudflare R2 Setup

1. **Create R2 Bucket:**
   - Go to Cloudflare Dashboard → R2 Object Storage
   - Create a new bucket named `hungy-documents` (or your preferred name)
   - Enable public access for the bucket

2. **Create API Token:**
   - Go to Cloudflare Dashboard → My Profile → API Tokens
   - Create a Custom Token with R2:Edit permissions
   - Note down the Access Key ID and Secret Access Key

3. **Configure CORS (Optional):**
   If you need browser uploads, configure CORS:
   ```json
   [
     {
       "AllowedOrigins": ["*"],
       "AllowedMethods": ["GET", "PUT", "POST", "DELETE"],
       "AllowedHeaders": ["*"]
     }
   ]
   ```

### 3. Dependencies
The following packages are automatically installed:
- `aws-sdk` - For S3-compatible R2 operations
- `multer` - For file upload handling
- `@types/multer` - TypeScript definitions

## API Endpoints

### GET /api/terms-and-conditions
Get all terms and conditions for the authenticated organization.

### POST /api/terms-and-conditions
Upload and create new terms and conditions.
- Body: FormData with `file`, `version`, `title`, `isActive`
- File types: PDF, Word, Text, Images (max 10MB)

### PUT /api/terms-and-conditions/:id
Update terms and conditions metadata (without file).
- Body: `{ version, title, isActive }`

### DELETE /api/terms-and-conditions/:id
Delete terms and conditions and associated file.

### PUT /api/terms-and-conditions/:id/file
Replace file for existing terms and conditions.
- Body: FormData with `file`

## Frontend Integration

The Terms and Conditions component is integrated into the Kitchen Details page and provides:

- **Table View:** List all terms and conditions with version, title, file info, status
- **Add Modal:** Upload new documents with metadata
- **Edit Modal:** Update document metadata
- **File Replace Modal:** Replace existing files
- **File Viewer:** Click file names to open in new tab
- **Delete Confirmation:** Safe deletion with confirmation

## File Storage Structure

Files are stored in R2 with the following structure:
```
hungy-documents/
  terms-and-conditions/
    {organizationId}/
      {timestamp}-{originalFileName}
```

## Security Features

- **Authentication:** All endpoints require valid JWT token
- **Organization Isolation:** Users can only access their organization's documents
- **File Type Validation:** Only allowed file types can be uploaded
- **File Size Limits:** Maximum 10MB per file
- **Version Uniqueness:** Each organization can have only one document per version

## Database Schema

The existing `TermsAndConditions` table is used:
- `id` - Primary key
- `organizationId` - Foreign key to Organization
- `version` - Unique version identifier per organization
- `title` - Document title
- `fileUrl` - Public URL to file in R2
- `fileName` - Original file name
- `fileSize` - File size in bytes
- `isActive` - Whether this version is active
- `createdAt` - Creation timestamp
- `updatedAt` - Last update timestamp
- `createdBy` - User who created the document

## Usage

1. Navigate to Kitchen Details page
2. Scroll to "Terms and Conditions" section
3. Click "Add New" to upload a document
4. Fill in version, title, select file, and set active status
5. Click "Save" to upload and create the record
6. Use table actions to edit, replace files, or delete documents
7. Click file names to view documents in new tab

## Troubleshooting

### File Upload Fails
- Check R2 credentials in .env file
- Verify bucket exists and has public access
- Check file size (max 10MB)
- Verify file type is allowed

### Files Not Accessible
- Ensure bucket has public read access
- Check CORS configuration if needed
- Verify file URL format

### Version Conflicts
- Each organization can only have one document per version
- Update existing document or use different version number 