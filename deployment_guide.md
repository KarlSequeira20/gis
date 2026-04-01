# Hostinger Deployment Guide

This guide will walk you through the process of uploading your GIS Dashboard to Hostinger and configuring your Google Maps API key for production.

---

## 1. Prepare Your Files
Ensure the following files are in your project folder (which you will upload):
- `index.html` (Main entry point)
- `info.html` (Secondary page)
- `script.js` (Updated for local GeoJSON loading)
- `style.css` (Styles)
- `info.js` (Support script)
- `india_states_lowres.geojson` (Local map data)
- `bandra_west.geojson` (Local map data - **50MB**)
- `GIS (3).xlsx` (Your data file)
- `.htaccess` (New file for compression)

---

## 2. Upload to Hostinger

### Option A: Using Hostinger File Manager (Recommended)
1.  Log in to your **Hostinger hPanel**.
2.  Navigate to **Websites** > **Manage** > **File Manager**.
3.  Open the `public_html` directory.
4.  Drag and drop all the files listed above into `public_html`.

### Option B: Using FTP (FileZilla)
1.  Get your FTP credentials from **Hostinger hPanel** > **Files** > **FTP Accounts**.
2.  Connect using an FTP client (like FileZilla).
3.  Upload all files into the `public_html` folder.

---

## 3. Secure Your Google Maps API Key
To prevent others from using your API key and to avoid unexpected charges, you must restrict it to your domain.

1.  Go to the [Google Cloud Console](https://console.cloud.google.com/google/maps-apis/credentials).
2.  Select your project and click on your **API Key**.
3.  Under **Key restrictions**, select **Websites**.
4.  Under **Website restrictions**, click **ADD**.
5.  Enter your domain (e.g., `https://yourdomain.com/*`).
6.  Under **API restrictions**, ensure **Maps JavaScript API** and **Places API** are selected.
7.  Click **SAVE**.

---

## 4. Verify Compression
Once uploaded, your site will load faster because of the `.htaccess` file. You can verify this by:
1.  Opening your site in Chrome.
2.  Pressing `F12` to open **Developer Tools**.
3.  Going to the **Network** tab and refreshing the page.
4.  Checking the `Content-Encoding` column for the `.geojson` and `.xlsx` files; it should say `gzip`.

---

> [!TIP]
> **Large File Note**: The 50MB `bandra_west.geojson` file is still quite large for a browser to handle. If you find the map is laggy on mobile devices, please let me know, and I can help you simplify the GeoJSON geometry to reduce its size.
