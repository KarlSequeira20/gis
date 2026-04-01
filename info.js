let leadsData = [];
let pincodeIndex = {};

document.addEventListener('DOMContentLoaded', () => {
    loadDatabase();
});

async function loadDatabase() {
    const loading = document.getElementById('loadingState');
    loading.style.display = 'block';

    try {
        const response = await fetch('GIS (3).xlsx');
        const arrayBuffer = await response.arrayBuffer();
        const data = new Uint8Array(arrayBuffer);
        const workbook = XLSX.read(data, { type: 'array' });
        const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
        const rawData = XLSX.utils.sheet_to_json(firstSheet);

        leadsData = rawData.map(row => {
            // Normalize Pincode - Supporting many variants and potential float numbers from Excel (e.g. 400050.0)
            let pinRaw = row['pincode'] || row['Pincode'] || row['PINCODE'] || row['Pin'] || row['PIN'] || row['Postal Code'] || row['zip'] || row['ZIP'] || row['Zip Code'] || 'Unknown';
            let pin = String(pinRaw).trim().split('.')[0]; // Clean off any ".0" from numeric Excel columns
            
            if (!pin || pin.toLowerCase() === 'na' || pin === 'nan' || pin === '-' || pin === '0') {
                pin = 'Unknown';
            }

            return {
                name: row['name'] || row['customer name'] || row['client'] || row['contact'] || row['lead name'] || row['partner'] || 'Unnamed Lead',
                date: row['column 1'] || row['date'] || '',
                leadSource: row['lead source'] || row['source'] || '',
                pincode: pin,
                status: row['status'] || 'N/A',
                propertyType: row['property type'] || row['product'] || '',
                state: row['state'] || 'Unknown',
                locality: row['locality'] || row['area'] || row['city'] || ''
            };
        });

        console.log(`Loaded ${leadsData.length} deals into directory.`);
        console.log("Sample Pincodes found in file:", [...new Set(leadsData.map(l => l.pincode))].slice(0, 10));
        console.log("Detected Lead count by State:", Object.entries(leadsData.reduce((acc, l) => { acc[l.state] = (acc[l.state] || 0) + 1; return acc; }, {})).slice(0, 5));
        const searchBox = document.querySelector('.search-large p') || document.createElement('p');
        searchBox.style.cssText = "color: #10b981; font-size: 12px; margin-top: 10px; font-weight: 600;";
        searchBox.textContent = `✅ Database Connected (${leadsData.length} records ready)`;
        if (!searchBox.parentElement) {
             document.querySelector('.directory-search').appendChild(searchBox);
        }

    } catch (error) {
        console.error("Error loading database:", error);
        alert("Could not load GIS (3).xlsx. Please ensure it is in the same folder.");
    } finally {
        loading.style.display = 'none';
    }
}

function performDirectorySearch() {
    const rawQuery = document.getElementById('directorySearch').value.trim();
    if (!rawQuery) return;
    
    const query = rawQuery.toLowerCase();

    // Use a fuzzy but robust search comparison
    const filtered = leadsData.filter(l => l.pincode.toLowerCase() === query);
    
    const resultsContainer = document.getElementById('resultsContainer');
    const noResults = document.getElementById('noResults');
    const summary = document.getElementById('pincodeSummary');
    const list = document.getElementById('leadList');

    if (filtered.length > 0) {
        noResults.style.display = 'none';
        resultsContainer.style.display = 'block';

        // Summary Stats
        const state = filtered[0].state;
        const locality = filtered[0].locality;
        
        summary.innerHTML = `
            <div class="stat-card" style="padding: 15px; background: rgba(99, 102, 241, 0.1); border: 1px solid rgba(99, 102, 241, 0.2); border-radius: 16px;">
                <div style="font-size: 24px; font-weight: 800; color: #818cf8;">${filtered.length}</div>
                <div style="font-size: 11px; color: #94a3b8; text-transform: uppercase; font-weight: 700;">Active Deals</div>
            </div>
            <div class="stat-card" style="padding: 15px; background: rgba(168, 85, 247, 0.1); border: 1px solid rgba(168, 85, 247, 0.2); border-radius: 16px;">
                <div style="font-size: 16px; font-weight: 800; color: #a855f7;">${state}</div>
                <div style="font-size: 11px; color: #94a3b8; text-transform: uppercase; font-weight: 700;">State</div>
            </div>
            <div class="stat-card" style="padding: 15px; background: rgba(34, 197, 94, 0.1); border: 1px solid rgba(34, 197, 94, 0.2); border-radius: 16px;">
                <div style="font-size: 16px; font-weight: 800; color: #22c55e;">${locality || 'N/A'}</div>
                <div style="font-size: 11px; color: #94a3b8; text-transform: uppercase; font-weight: 700;">Market Area</div>
            </div>
            <div class="stat-card" style="padding: 15px; background: rgba(236, 72, 153, 0.1); border: 1px solid rgba(236, 72, 153, 0.2); border-radius: 16px;">
                <div style="font-size: 16px; font-weight: 800; color: #ec4899;">${[...new Set(filtered.map(l => l.leadSource))].length}</div>
                <div style="font-size: 11px; color: #94a3b8; text-transform: uppercase; font-weight: 700;">Sources</div>
            </div>
        `;

        // List - Capped at 500 records to prevent UI lag
        const displayList = filtered.slice(0, 500);
        list.innerHTML = displayList.map(l => `
            <div class="lead-card">
                <div>
                    <div class="lead-name">${l.name}</div>
                    <div style="font-size:11px; color:#64748b; margin-top:4px;">${l.propertyType || 'Residential'} • ${l.date}</div>
                </div>
                <div class="lead-source">
                    <span style="display:inline-block; padding: 4px 8px; background: rgba(255,255,255,0.05); border-radius:4px;">${l.leadSource}</span>
                </div>
                <div class="lead-status">
                    <span class="status-badge default">${l.status}</span>
                </div>
            </div>
        `).join('');

        if (filtered.length > 500) {
            list.innerHTML += `
                <div style="padding: 20px; text-align: center; color: #94a3b8; font-size: 13px; border-top: 1px solid rgba(255,255,255,0.05);">
                    ⚠️ Showing first 500 of ${filtered.length} results. Please use a more specific search to see all.
                </div>
            `;
        }

    } else {
        resultsContainer.style.display = 'none';
        noResults.innerHTML = `
            <h2>No Deals Found</h2>
            <p>We couldn't find any data for Pincode <strong>${query}</strong>.</p>
        `;
        noResults.style.display = 'block';
    }
}
