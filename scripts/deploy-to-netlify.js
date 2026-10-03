const fs = require('fs');
const https = require('https');
const path = require('path');

const token = process.argv[2] || process.env.NETLIFY_AUTH_TOKEN;
const zipPath = process.argv[3] || path.join(__dirname, '..', 'dist-angular.zip');
const siteName = process.argv[4] || '';

if (!token) {
  console.error('Error: Please provide a Netlify Personal Access Token.');
  console.error('Usage: node scripts/deploy-to-netlify.js <NETLIFY_TOKEN> [zipPath] [siteName]');
  process.exit(1);
}

const resolvedZip = path.resolve(zipPath);
if (!fs.existsSync(resolvedZip)) {
  console.error(`Error: ZIP file not found at ${resolvedZip}`);
  process.exit(1);
}

console.log(`Uploading ${resolvedZip} (${(fs.statSync(resolvedZip).size / (1024 * 1024)).toFixed(2)} MB) to Netlify...`);
const zipData = fs.readFileSync(resolvedZip);

let apiPath = '/api/v1/sites';
if (siteName) {
  apiPath += `?name=${encodeURIComponent(siteName)}`;
}

const req = https.request({
  hostname: 'api.netlify.com',
  path: apiPath,
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${token.trim()}`,
    'Content-Type': 'application/zip',
    'Content-Length': zipData.length
  }
}, (res) => {
  let body = '';
  res.on('data', chunk => body += chunk);
  res.on('end', () => {
    try {
      const data = JSON.parse(body);
      if (res.statusCode >= 200 && res.statusCode < 300) {
        console.log('\n=============================================');
        console.log('🎉 DEPLOYMENT SUCCESSFUL!');
        console.log(`🌐 Live URL:   ${data.ssl_url || data.url}`);
        console.log(`🆔 Site ID:    ${data.site_id || data.id}`);
        console.log(`📦 Deploy URL: ${data.deploy_ssl_url || data.deploy_url}`);
        console.log('=============================================\n');
      } else {
        console.error(`Deployment failed (Status ${res.statusCode}):`, data.message || body);
      }
    } catch (err) {
      console.error('Failed to parse Netlify response:', body);
    }
  });
});

req.on('error', (err) => {
  console.error('Request error:', err.message);
});

req.write(zipData);
req.end();
