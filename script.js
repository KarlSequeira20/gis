// Global variables
let map;
let leadsData = [];
let pincodeMarkers = {};
let currentView = 'india';
let currentState = null;
let filteredData = [];
let geoJsonLoaded = false;
let stateLeadsMap = {};
let markerCluster = null;
let postalCodeLayer;
let highlightedPincode = null;

// Cloud Console Project Configuration
const MAP_ID = '80777b8ad4ad293c9d11c60b';

// Helper to darken/lighten colors for gradients
function adjustColor(color, amount) {
    return '#' + color.replace(/^#/, '').replace(/../g, color => ('0' + Math.min(255, Math.max(0, parseInt(color, 16) + amount)).toString(16)).slice(-2));
}

// geocodeCache initialization
let geocodeCache = {};
try {
    geocodeCache = JSON.parse(localStorage.getItem('geocodeCache')) || {};
} catch (e) { }

// ─── AUTO-LOAD on startup ────────────────────────────────────────────────────
window.addEventListener('load', function () {
    autoLoadFile('GIS (3).xlsx');
});

function autoLoadFile(filename) {
    const statusDiv = document.getElementById('uploadStatus');
    const uploadPanel = document.getElementById('uploadPanel');

    uploadPanel.style.display = 'flex';
    statusDiv.innerHTML = `<p class="loading">⏳ Loading ${filename}…</p>`;

    fetch(filename)
        .then(response => {
            if (!response.ok) {
                throw new Error(`Could not fetch "${filename}" (HTTP ${response.status}). Make sure the file is in the same folder as this HTML.`);
            }
            return response.arrayBuffer();
        })
        .then(buffer => {
            const data = new Uint8Array(buffer);
            const workbook = XLSX.read(data, { type: 'array' });
            const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
            const jsonData = XLSX.utils.sheet_to_json(firstSheet);
            processLeadsData(jsonData);
        })
        .catch(error => {
            statusDiv.innerHTML = `
                <p class="error">⚠️ Auto-load failed: ${error.message}</p>
                <p style="margin-top:10px;color:#94a3b8;font-size:13px;">Please select the file manually below.</p>
            `;
            document.getElementById('fileInput').style.display = 'block';
            document.getElementById('uploadBtn').style.display = 'block';
        });
}

// ─── Manual file upload (fallback) ──────────────────────────────────────────
document.getElementById('fileInput').addEventListener('change', function (e) {
    const file = e.target.files[0];
    if (file) {
        document.getElementById('uploadBtn').disabled = false;
    }
});

function processFile() {
    const fileInput = document.getElementById('fileInput');
    const file = fileInput.files[0];

    if (!file) {
        alert('Please select a file first');
        return;
    }

    const statusDiv = document.getElementById('uploadStatus');
    statusDiv.innerHTML = '<p class="loading">Processing file…</p>';

    const reader = new FileReader();

    reader.onload = function (e) {
        try {
            const data = e.target.result;

            if (file.name.endsWith('.csv')) {
                Papa.parse(data, {
                    header: true,
                    complete: function (results) {
                        processLeadsData(results.data);
                    },
                    error: function (error) {
                        statusDiv.innerHTML = `<p class="error">Error parsing CSV: ${error.message}</p>`;
                    }
                });
            } else {
                const workbook = XLSX.read(data, { type: 'binary' });
                const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
                const jsonData = XLSX.utils.sheet_to_json(firstSheet);
                processLeadsData(jsonData);
            }
        } catch (error) {
            statusDiv.innerHTML = `<p class="error">Error: ${error.message}</p>`;
        }
    };

    if (file.name.endsWith('.csv')) {
        reader.readAsText(file);
    } else {
        reader.readAsBinaryString(file);
    }
}

// ─── Data processing ─────────────────────────────────────────────────────────
function processLeadsData(data) {
    // Normalize keys to lowercase and trim to easily match headers like "Zip Code "
    const normalizedData = data.map(row => {
        const newRow = {};
        for (const key in row) {
            newRow[String(key).trim().toLowerCase()] = row[key];
        }
        return newRow;
    });

    leadsData = normalizedData.filter(row => {
        // Filter out completely blank trailing rows, but keep valid leads even if missing a ZIP code
        return row['column 1'] || row['date'] || row['lead name'] || row['name'] || row['lead source'] || row['city'];
    }).map(row => {
        let pin = String(row['zip code'] || row['pincode'] || row['pin code'] || row['pin'] || row['zip'] || '').trim();
        if (!pin || pin.toLowerCase() === 'na' || pin === '-' || pin === '0') {
            pin = 'Unknown';
        }

        return {
            date: row['column 1'] || row['date'] || '',
            leadSource: row['lead source'] || row['source'] || '',
            propertyType: row['propertytype'] || row['property type'] || row['type'] || '',
            status: row['lead status'] || row['status'] || '',
            name: row['lead name'] || row['name'] || row['customer name'] || '',
            city: row['city'] || '',
            pincode: pin,
            locality: row['general area'] || row['location - pc'] || row['locality'] || row['area'] || '',
            state: row['stat'] || row['state'] || 'Maharashtra',
            campaign: row['fb ad'] || row['campaign'] || '',
            adset: row['adset'] || row['ad set'] || '',
            reach: parseInt(row['reach'] || 0),
            raw: row
        };
    });

    filteredData = [...leadsData];

    if (leadsData.length === 0) {
        document.getElementById('uploadStatus').innerHTML = '<p class="error">No valid data found in file</p>';
        return;
    }

    document.getElementById('uploadStatus').innerHTML = `<p class="success">✓ Loaded ${leadsData.length} deals</p>`;

    populateFilters();

    setTimeout(() => {
        document.getElementById('uploadPanel').style.display = 'none';
        document.getElementById('controlPanel').style.display = 'block';
        document.getElementById('legend').style.display = 'block';
        initializeMap();
    }, 800);
}

function populateFilters() {
    // 1. State Filter
    const stateCounts = {};
    leadsData.forEach(l => {
        const s = l.state || 'Unknown';
        stateCounts[s] = (stateCounts[s] || 0) + 1;
    });

    const stateFilter = document.getElementById('stateFilter');
    while (stateFilter.options.length > 1) stateFilter.remove(1);

    Object.entries(stateCounts)
        .sort((a, b) => b[1] - a[1]) // Sort by count
        .forEach(([state, count]) => {
            const option = document.createElement('option');
            option.value = state;
            option.textContent = `${state} (${count} Deals)`;
            stateFilter.appendChild(option);
        });

    // Initial pincode population (all)
    populatePincodeFilter('');

    // 3. Source Filter
    const sourceCounts = {};
    leadsData.forEach(l => {
        if (l.leadSource) sourceCounts[l.leadSource] = (sourceCounts[l.leadSource] || 0) + 1;
    });

    const sourceFilter = document.getElementById('sourceFilter');
    while (sourceFilter.options.length > 1) sourceFilter.remove(1);
    Object.entries(sourceCounts).sort((a, b) => b[1] - a[1]).forEach(([source, count]) => {
        const option = document.createElement('option');
        option.value = source;
        option.textContent = `${source} (${count})`;
        sourceFilter.appendChild(option);
    });

    // 4. Property Filter
    const propertyCounts = {};
    leadsData.forEach(l => {
        if (l.propertyType) propertyCounts[l.propertyType] = (propertyCounts[l.propertyType] || 0) + 1;
    });

    const propertyFilter = document.getElementById('propertyFilter');
    while (propertyFilter.options.length > 1) propertyFilter.remove(1);
    Object.entries(propertyCounts).sort((a, b) => b[1] - a[1]).forEach(([type, count]) => {
        const option = document.createElement('option');
        option.value = type;
        option.textContent = `${type} (${count})`;
        propertyFilter.appendChild(option);
    });
}

function handleStateFilterChange() {
    const stateVal = document.getElementById('stateFilter').value;
    populatePincodeFilter(stateVal);
    applyFilters();
}

function populatePincodeFilter(stateName) {
    const pincodeFilter = document.getElementById('pincodeFilter');
    const currentVal = pincodeFilter.value; // Try to preserve if it still exists
    while (pincodeFilter.options.length > 1) pincodeFilter.remove(1);

    let sourceData = leadsData;
    if (stateName) {
        sourceData = leadsData.filter(l => l.state === stateName);
    }

    const pinDetails = {}; // { pin: { count: N, name: "Name" } }
    sourceData.forEach(l => {
        if (l.pincode && l.pincode !== 'Unknown') {
            if (!pinDetails[l.pincode]) {
                const name = l.locality || l.city || '';
                pinDetails[l.pincode] = { count: 0, name: name };
            }
            pinDetails[l.pincode].count++;
        }
    });

    Object.entries(pinDetails)
        .sort((a, b) => b[1].count - a[1].count)
        .forEach(([pin, details]) => {
            if (details.count > 0) {
                const option = document.createElement('option');
                option.value = pin;
                const displayName = details.name ? `${pin} - ${details.name}` : pin;
                option.textContent = `${displayName} (${details.count})`;
                pincodeFilter.appendChild(option);
            }
        });

    // Resume previous value if applicable
    if (currentVal && pinDetails[currentVal]) {
        pincodeFilter.value = currentVal;
    }
}

function applyFilters() {
    const stateFilter = document.getElementById('stateFilter').value;
    const pincodeFilter = document.getElementById('pincodeFilter').value;
    const sourceFilter = document.getElementById('sourceFilter').value;
    const propertyFilter = document.getElementById('propertyFilter').value;

    filteredData = leadsData.filter(lead => {
        let matches = true;
        if (stateFilter && lead.state !== stateFilter) matches = false;
        if (pincodeFilter && lead.pincode !== pincodeFilter) matches = false;
        if (sourceFilter && lead.leadSource !== sourceFilter) matches = false;
        if (propertyFilter && lead.propertyType !== propertyFilter) matches = false;
        return matches;
    });

    if (pincodeFilter) {
        // If we filter by a specific pin, zoom to it
        zoomToPincode(pincodeFilter);
    } else if (stateFilter) {
        // Switch to state view if a state is selected
        if (currentState !== stateFilter || currentView !== 'state') {
            showStateView(stateFilter);
        } else {
            // Just refresh current state view markers
            showStateView(currentState);
        }
    } else if (currentView === 'india') {
        showIndiaView();
    } else {
        // Back to India view if everything cleared
        showIndiaView();
    }
}

// ─── Map ─────────────────────────────────────────────────────────────────────
function initializeMap() {
    map = new google.maps.Map(document.getElementById('map'), {
        center: { lat: 19.0544, lng: 72.8402 }, // Center on Bandra West
        zoom: 14,
        mapId: MAP_ID,
    });

    const statusDiv = document.getElementById('geofenceStatus');
    try {
        // Load local GeoJSON for the specific Bandra West boundary
        map.data.loadGeoJson('bandra_west.geojson');

        applyDataLayerStyle();

        if (statusDiv) {
            statusDiv.innerHTML = "✅ Local GeoJSON Active";
            statusDiv.style.color = "#10b981";
        }
    } catch (e) {
        console.error("Local GeoJSON loading failed", e);
        if (statusDiv) {
            statusDiv.innerHTML = "❌ Layer Error";
            statusDiv.style.color = "#ef4444";
        }
    }

    // Load GeoJSON for Indian States (Restored)
    // Load GeoJSON for Indian States (Local file for reliability)
    map.data.loadGeoJson('india_states_lowres.geojson', null, () => {
        geoJsonLoaded = true;
        // User requested that first view shows all states
        showIndiaView();
    });

    // GeoJSON listeners for interaction
    map.data.addListener('click', (event) => {
        if (currentView === 'india') {
            const stateName = event.feature.getProperty('NAME_1');
            const matchedState = Object.keys(stateLeadsMap).find(s => s.toLowerCase() === stateName.toLowerCase() || s.toLowerCase().includes(stateName.toLowerCase()) || stateName.toLowerCase().includes(s.toLowerCase()));

            if (matchedState && stateLeadsMap[matchedState].length > 0) {
                const bounds = new google.maps.LatLngBounds();
                event.feature.getGeometry().forEachLatLng(latlng => {
                    bounds.extend(latlng);
                });
                map.fitBounds(bounds);
                showStateView(matchedState);
            }
        }
    });

    map.data.addListener('mouseover', (event) => {
        if (currentView === 'india') {
            const stateName = event.feature.getProperty('NAME_1');
            const matchedState = Object.keys(stateLeadsMap).find(s => s.toLowerCase() === stateName.toLowerCase() || s.toLowerCase().includes(stateName.toLowerCase()) || stateName.toLowerCase().includes(s.toLowerCase()));

            if (matchedState && stateLeadsMap[matchedState].length > 0) {
                map.data.overrideStyle(event.feature, { fillOpacity: 0.7, strokeWeight: 2, strokeColor: '#a855f7' });
            }
        }
    });

    map.data.addListener('mouseout', (event) => {
        if (currentView === 'india') {
            map.data.revertStyle();
        }
    });
    // Initial view set by Map Options (Bandra West focus)
}

function showIndiaView() {
    highlightedPincode = null;
    currentState = null;
    currentView = 'india';

    clearMapOverlays();

    stateLeadsMap = {};
    filteredData.forEach(lead => {
        const s = lead.state || 'Unknown';
        if (!stateLeadsMap[s]) stateLeadsMap[s] = [];
        stateLeadsMap[s].push(lead);
    });

    refreshMapStyles();

    updateGlobalStats();
    if (map) {
        map.setCenter({ lat: 21.5, lng: 79.0 });
        map.setZoom(5);
    }
}

function showStateView(stateName, onComplete) {
    currentView = 'state';
    currentState = stateName;
    highlightedPincode = null; // Clear pincode highlight when switching states

    clearMapOverlays();
    refreshMapStyles();

    const stateLeads = filteredData.filter(l => l.state === stateName);

    const pincodeLeads = {};
    stateLeads.forEach(lead => {
        if (!pincodeLeads[lead.pincode]) {
            pincodeLeads[lead.pincode] = [];
        }
        pincodeLeads[lead.pincode].push(lead);
    });

    const validPincodes = Object.keys(pincodeLeads).filter(pin => pin !== 'Unknown');
    let processed = 0;
    const total = validPincodes.length;

    if (total === 0) {
        if (onComplete) onComplete();
    } else {
        validPincodes.forEach(pincode => {
            geocodePincode(pincode, pincodeLeads[pincode], () => {
                processed++;
                if (processed === total) {
                    fitBoundsToMarkers();
                    initMarkerClusterer();
                    saveGeocodeCache(); // Batch save after all geocoding is complete
                    if (onComplete) onComplete();
                }
            });
        });
    }

    const unmappedCount = pincodeLeads['Unknown'] ? pincodeLeads['Unknown'].length : 0;
    updateStateStats(stateName, stateLeads, unmappedCount);
}

function geocodePincode(pincode, leads, callback) {
    // Clean pincode: remove spaces, dots, or other artifacts common in messy data
    const cleanPin = String(pincode || '').replace(/[^0-9]/g, '').trim();
    const isPincodeStandard = cleanPin.length === 6;

    // In our cache we use the user-provided string for matching, but clean it for storage
    const cacheKey = `${pincode}_${currentState}`.toLowerCase();

    if (geocodeCache[cacheKey]) {
        setTimeout(() => {
            createPincodeMarker(pincode, geocodeCache[cacheKey], leads);
            callback();
        }, 5);
        return;
    }

    const geocoder = new google.maps.Geocoder();
    const firstLead = leads[0] || {};
    const city = firstLead.city || '';

    // BUILD FLEXIBLE SEARCH STRING
    // If we have a proper pincode, use the strict format. 
    // Otherwise, treat the entire pincode field as an address (e.g., "Alibag" or "Mumbai 400033")
    const searchString = isPincodeStandard
        ? `${city ? city + ', ' : ''}${currentState} ${cleanPin}`
        : `${pincode}, ${currentState}, India`;

    const geocodeOptions = {
        address: searchString,
        region: 'IN'
    };

    // Only apply component restriction if the input is a valid-looking numeric pincode
    if (isPincodeStandard) {
        geocodeOptions.componentRestrictions = {
            postalCode: cleanPin,
            country: 'IN'
        };
    }

    geocoder.geocode(geocodeOptions, (results, status) => {
        if (status === 'OK' && results[0]) {
            const locationType = results[0].geometry.location_type;
            const strippedResult = {
                geometry: {
                    location: {
                        lat: typeof results[0].geometry.location.lat === 'function' ? results[0].geometry.location.lat() : results[0].geometry.location.lat,
                        lng: typeof results[0].geometry.location.lng === 'function' ? results[0].geometry.location.lng() : results[0].geometry.location.lng
                    }
                },
                formatted_address: results[0].formatted_address,
                location_type: locationType,
                types: results[0].types
            };

            geocodeCache[cacheKey] = strippedResult;
            createPincodeMarker(pincode, strippedResult, leads);
            callback();
        } else if (status === 'OVER_QUERY_LIMIT') {
            setTimeout(() => geocodePincode(pincode, leads, callback), 1000);
        } else {
            console.warn(`Geocoding failed for [${pincode}] with search string [${searchString}]. Status: ${status}`);
            callback();
        }
    });
}

function saveGeocodeCache() {
    try {
        localStorage.setItem('geocodeCache', JSON.stringify(geocodeCache));
        console.log("📍 Geocode Cache Saved to Disk");
    } catch (e) {
        console.warn("Failed to save geocode cache:", e);
    }
}

function createPincodeMarker(pincode, geocodeResult, leads) {
    const location = geocodeResult.geometry.location;
    const leadCount = leads.length;

    // Quality Audit: Check if this was a fuzzy result
    const isApproximate = geocodeResult.location_type === 'APPROXIMATE';
    const isNotPostalCode = geocodeResult.types && !geocodeResult.types.includes('postal_code');
    const isSuspect = isApproximate || isNotPostalCode;

    const baseColor = getColorByDensity(leadCount);
    const color = baseColor; // We now use a badge for suspect markers instead of changing base color

    // Create DOM element for Advanced Marker
    const markerContent = document.createElement('div');
    markerContent.className = `custom-pin-marker ${isSuspect ? 'suspect' : ''}`;
    markerContent.style.background = `radial-gradient(circle at 30% 30%, ${color}, ${adjustColor(color, -20)})`;

    // Scale based on density
    const size = isSuspect ? 32 : Math.min(52, 28 + (leadCount / 1.5));
    markerContent.style.width = `${size}px`;
    markerContent.style.height = `${size}px`;
    markerContent.style.lineHeight = `${size}px`;
    markerContent.textContent = leadCount;

    // Add pulse for high density (50+)
    if (leadCount >= 50) {
        const pulse = document.createElement('div');
        pulse.className = 'marker-pulse';
        pulse.style.color = color;
        markerContent.appendChild(pulse);
    }

    const marker = new google.maps.marker.AdvancedMarkerElement({
        map: map,
        position: location,
        content: markerContent,
        title: `Pincode: ${pincode}${isSuspect ? ' (⚠️ Low Confidence Mapping)' : ''}`
    });

    const clickHandler = () => {
        showPincodeInfo(pincode, leads, geocodeResult);
        map.panTo(location);
        smoothZoom(map, 14, Math.round(map.getZoom()));

        highlightedPincode = pincode;
        refreshMapStyles();
    };

    marker.addListener('click', clickHandler);

    pincodeMarkers[pincode] = { marker, polygon: { setMap: () => { } }, leads, isSuspect };
}

function showPincodeInfo(pincode, leads, geocodeResult = {}) {
    const panel = document.getElementById('infoPanel');
    const content = document.getElementById('infoPanelContent');

    const totalLeads = leads.length;
    const isSuspect = geocodeResult.location_type === 'APPROXIMATE' || (geocodeResult.types && !geocodeResult.types.includes('postal_code'));

    let auditHtml = `
        <div class="audit-tag ${isSuspect ? 'suspect' : 'verified'}">
            ${isSuspect ? '⚠️ Approximate Mapping' : '✅ Verified Pincode Level'}
        </div>
    `;

    const sources = {};
    const propertyTypes = {};
    const statuses = {};
    let totalReach = 0;

    leads.forEach(lead => {
        if (lead.leadSource) sources[lead.leadSource] = (sources[lead.leadSource] || 0) + 1;
        if (lead.propertyType) propertyTypes[lead.propertyType] = (propertyTypes[lead.propertyType] || 0) + 1;
        if (lead.status) statuses[lead.status] = (statuses[lead.status] || 0) + 1;
        totalReach += lead.reach || 0;
    });

    let html = `
        <h3>📍 Pincode: ${pincode}</h3>
        <div class="info-stat-box">
            <div class="stat-large">${totalLeads}</div>
            <div class="stat-label">Total Ongoing Deals</div>
        </div>
    `;

    const generateBars = (dataObj, title) => {
        if (Object.keys(dataObj).length === 0) return '';
        let sectionHtml = `<div class="info-section"><h4>${title}</h4>`;
        Object.entries(dataObj).sort((a, b) => b[1] - a[1]).forEach(([label, count]) => {
            const percentage = ((count / totalLeads) * 100).toFixed(1);
            sectionHtml += `
                <div class="info-bar">
                    <div class="info-bar-label"><span>${label || 'Unknown'}</span> <span>${count} (${percentage}%)</span></div>
                    <div class="info-bar-bg">
                        <div class="info-bar-fill" style="width: ${percentage}%"></div>
                    </div>
                </div>
            `;
        });
        sectionHtml += '</div>';
        return sectionHtml;
    };

    html += generateBars(sources, 'Lead Sources');
    html += generateBars(propertyTypes, 'Property Types');
    html += generateBars(statuses, 'Lead Status');

    if (geocodeResult.formatted_address) {
        html += `
            <div class="info-section">
                <h4>Mapped To</h4>
                <p style="font-size: 13px; color: #94a3b8; line-height: 1.4;">${geocodeResult.formatted_address}</p>
                ${isSuspect ? '<p style="margin-top:8px; font-size:11px; color:#fbbf24;">Google could not find this exact PIN; mapping to city center instead.</p>' : ''}
            </div>
        `;
    }

    if (totalReach > 0) {
        html += `
            <div class="info-section">
                <h4>Campaign Reach</h4>
                <div class="reach-display">
                    <span class="reach-number">${totalReach.toLocaleString()}</span>
                    <span class="reach-label">Total Impressions</span>
                </div>
            </div>
        `;
    }

    content.innerHTML = auditHtml + html;
    panel.classList.add('visible');
}

function closeInfoPanel() {
    document.getElementById('infoPanel').classList.remove('visible');
}

function clearMapOverlays() {
    if (markerCluster) {
        markerCluster.clearMarkers();
    }
    Object.values(pincodeMarkers).forEach(({ marker, polygon }) => {
        marker.map = null; // AdvancedMarkerElement uses .map property instead of setMap()
        if (polygon && typeof polygon.setMap === 'function') polygon.setMap(null);
    });
    pincodeMarkers = {};
}

function smoothZoom(map, targetZoom, currentZoom) {
    if (currentZoom === targetZoom) return;
    const step = currentZoom < targetZoom ? 1 : -1;

    setTimeout(() => {
        map.setZoom(currentZoom + step);
        if (currentZoom + step !== targetZoom) {
            google.maps.event.addListenerOnce(map, 'zoom_changed', () => {
                smoothZoom(map, targetZoom, currentZoom + step);
            });
        }
    }, 80);
}

function fitBoundsToMarkers() {
    if (Object.keys(pincodeMarkers).length === 0) return;

    const bounds = new google.maps.LatLngBounds();
    Object.values(pincodeMarkers).forEach(({ marker }) => {
        bounds.extend(marker.getPosition());
    });
    map.fitBounds(bounds);
}

function initMarkerClusterer() {
    if (markerCluster) {
        markerCluster.clearMarkers();
    }
    const markers = Object.values(pincodeMarkers).map(obj => obj.marker).filter(m => !!m);

    markerCluster = new markerClusterer.MarkerClusterer({
        map,
        markers,
        renderer: {
            render: function ({ count, position }) {
                const color = count > 50 ? '#ec4899' : count > 20 ? '#a855f7' : '#6366f1';

                const container = document.createElement('div');
                container.className = 'custom-pin-marker';
                container.style.background = `radial-gradient(circle at 30% 30%, ${color}, ${adjustColor(color, -20)})`;
                const size = Math.min(64, 32 + (count / 4));
                container.style.width = `${size}px`;
                container.style.height = `${size}px`;
                container.style.lineHeight = `${size}px`;
                container.textContent = count;
                container.style.fontSize = '15px';

                // High density cluster pulse
                if (count > 20) {
                    const pulse = document.createElement('div');
                    pulse.className = 'marker-pulse';
                    pulse.style.color = color;
                    container.appendChild(pulse);
                }

                return new google.maps.marker.AdvancedMarkerElement({
                    position,
                    content: container,
                    zIndex: 1000 + count
                });
            }
        }
    });

}

function resetToIndia() {
    document.getElementById('stateFilter').value = '';
    document.getElementById('pincodeFilter').value = '';
    document.getElementById('sourceFilter').value = '';
    document.getElementById('propertyFilter').value = '';
    populatePincodeFilter('');
    showIndiaView();
}

function getColorByDensity(count) {
    if (count >= 50) return '#60a5fa'; // vibrant blue
    if (count >= 20) return '#a855f7'; // vibrant purple
    if (count >= 10) return '#ec4899'; // pink
    return '#8b5cf6'; // violet
}

/* Updated Legend in script.js to match CSS Theme */
document.addEventListener("DOMContentLoaded", () => {
    const legend = document.getElementById('legend');
    if (legend) {
        legend.innerHTML = `
            <h4 style="margin-top:0;">Audit Legend</h4>
            <div class="legend-item" style="margin-bottom:15px;">
                <span class="legend-color" style="background: #fbbf24; border-radius: 50%; width:18px; height:18px;"></span>
                <span>⚠️ Low Confidence</span>
            </div>
            <h4 style="border-top: 1px solid rgba(255,255,255,0.1); padding-top:10px;">Lead Density</h4>
            <div class="legend-item"><span class="legend-color" style="background: #60a5fa;"></span><span>High (50+)</span></div>
            <div class="legend-item"><span class="legend-color" style="background: #a855f7;"></span><span>Medium (20-49)</span></div>
            <div class="legend-item"><span class="legend-color" style="background: #ec4899;"></span><span>Low (10-19)</span></div>
            <div class="legend-item"><span class="legend-color" style="background: #8b5cf6;"></span><span>Very Low (1-9)</span></div>
        `;
    }
});

function updateGlobalStats() {
    const statsGrid = document.getElementById('statsGrid');
    const totalLeads = leadsData.length;
    const currentLeads = filteredData.length;
    const states = [...new Set(filteredData.map(l => l.state))].length;
    const pincodes = [...new Set(filteredData.map(l => l.pincode))].length;

    // Audit count
    const suspectCount = Object.values(pincodeMarkers).filter(m => m.isSuspect).length;

    let filterInfo = '';
    if (suspectCount > 0) {
        filterInfo += `
        <div class="stat-card audit-alert" style="grid-column: span 2;">
            <div class="stat-value" style="color: #fbbf24;">${suspectCount} Suspect Mappings</div>
            <div class="stat-label">Manual Audit Recommended</div>
        </div>
        `;
    }

    if (currentLeads < totalLeads) {
        let context = 'Results';
        if (pincodeFilter) context = `PIN ${pincodeFilter}`;
        else if (stateFilter) context = stateFilter;

        filterInfo = `
        <div class="stat-card" style="grid-column: span 2; background: rgba(99, 102, 241, 0.1); border-color: rgba(99, 102, 241, 0.3);">
            <div class="stat-value" style="font-size: 16px; color: #818cf8;">${currentLeads} / ${totalLeads} Deals</div>
            <div class="stat-label">Matching ${context}</div>
        </div>
        `;
    }

    statsGrid.innerHTML = `
        ${filterInfo}
        <div class="stat-card">
            <div class="stat-value">${currentLeads}</div>
            <div class="stat-label">Total Deals</div>
        </div>
        <div class="stat-card">
            <div class="stat-value">${states}</div>
            <div class="stat-label">States</div>
        </div>
        <div class="stat-card" style="grid-column: span 2;">
            <div class="stat-value">${pincodes}</div>
            <div class="stat-label">Pincodes Identified</div>
        </div>
    `;
}

function updateStateStats(stateName, leads, unmappedCount = 0) {
    const statsGrid = document.getElementById('statsGrid');
    const validLeads = leads.filter(l => l.pincode !== 'Unknown');
    const pincodes = [...new Set(validLeads.map(l => l.pincode))].length;

    let unmappedHtml = '';
    if (unmappedCount > 0) {
        unmappedHtml = `
        <div class="stat-card" style="grid-column: span 2; background: rgba(236, 72, 153, 0.1); border-color: rgba(236, 72, 153, 0.2);">
            <div class="stat-value" style="color: #f472b6; font-size: 18px;">${unmappedCount}</div>
            <div class="stat-label" style="color: #fce7f3;">Deals Pending Exact Pincode</div>
        </div>
        `;
    }

    statsGrid.innerHTML = `
        <div class="stat-card" style="grid-column: span 2;">
            <div class="stat-value" style="font-size: 20px;">${stateName}</div>
            <div class="stat-label">Current Region</div>
        </div>
        <div class="stat-card">
            <div class="stat-value">${leads.length}</div>
            <div class="stat-label">Total Deals</div>
        </div>
        <div class="stat-card">
            <div class="stat-value">${pincodes}</div>
            <div class="stat-label">Mapped Pincodes</div>
        </div>
        ${unmappedHtml}
    `;
}

// ─── Search Functionality ───────────────────────────────────────────────────
window.searchPincode = function () {
    const searchVal = document.getElementById('pincodeSearch').value.trim();
    if (!searchVal) return;

    // Find if the pincode exists in our dataset
    const lead = filteredData.find(l => l.pincode.toLowerCase() === searchVal.toLowerCase());

    if (!lead) {
        alert("Pincode not found in current data.");
        return;
    }

    if (currentView === 'state' && currentState === lead.state) {
        zoomToPincode(lead.pincode);
    } else {
        // Switch to the state where the pincode is located, then zoom
        showStateView(lead.state, () => {
            zoomToPincode(lead.pincode);
        });
    }
}

function zoomToPincode(pincode) {
    const markerObj = pincodeMarkers[pincode];
    if (markerObj && markerObj.marker) {
        // simulate a click to open the info panel and zoom in
        google.maps.event.trigger(markerObj.marker, 'click');

        // Highlight boundary (Geofence isolation)
        highlightedPincode = pincode;
        refreshMapStyles();

        // Slightly bounce the marker to highlight it
        markerObj.marker.setAnimation(google.maps.Animation.BOUNCE);
        setTimeout(() => markerObj.marker.setAnimation(null), 2100);
    } else {
        // If not in current state, we'll wait for the switch then try again
        console.warn("Could not locate marker for pincode immediately:", pincode);
        highlightedPincode = pincode;
        refreshMapStyles();
    }
}

function refreshMapStyles() {
    if (!map || !map.data) return;

    map.data.setStyle((feature) => {
        const pincode = feature.getProperty('pincode');
        const stateName = feature.getProperty('NAME_1');

        // 1. Style for Pincode Boundaries (Isolate selected pincode)
        if (pincode) {
            if (pincode === highlightedPincode) {
                return {
                    fillColor: 'rgba(0,0,0,0)',
                    fillOpacity: 0,
                    strokeColor: '#ef4444',
                    strokeWeight: 3,
                    visible: true
                };
            }
            // Hide all other pincode boundaries as requested
            return { visible: false };
        }

        // 2. Style for India States Boundaries
        if (stateName) {
            const featureNameLower = stateName.toLowerCase();

            // Handle common naming discrepancies between GeoJSON and Excel
            const stateNameMap = {
                'orissa': 'odisha',
                'uttaranchal': 'uttarakhand',
                'andaman and nicobar': 'andaman',
                'puducherry': 'pondicherry',
                'telangana': 'telangana', // ensure it maps even if fuzzy fails
            };

            const normalizedName = stateNameMap[featureNameLower] || featureNameLower;

            const matchingKey = Object.keys(stateLeadsMap).find(s => {
                const sLower = s.toLowerCase();
                return sLower.includes(normalizedName) || normalizedName.includes(sLower);
            });

            let leadCount = 0;
            if (matchingKey && stateLeadsMap[matchingKey]) {
                leadCount = stateLeadsMap[matchingKey].length;
            }

            // In India view, show density choropleth
            if (currentView === 'india') {
                if (leadCount > 0) {
                    return {
                        fillColor: getColorByDensity(leadCount),
                        fillOpacity: 0.45,
                        strokeColor: '#6366f1',
                        strokeWeight: 1.5,
                        visible: true
                    };
                } else {
                    return { visible: false };
                }
            }
            // In State view, highlight ONLY the selected state
            else if (currentView === 'state') {
                // If a specific pincode is being viewed, hide all state backgrounds/boundaries entirely
                if (highlightedPincode) return { visible: false };

                const isSelected = matchingKey === currentState || stateName === currentState;
                if (isSelected) {
                    return {
                        fillColor: '#1e293b',
                        fillOpacity: 0.2,
                        strokeColor: '#818cf8',
                        strokeWeight: 2,
                        visible: true
                    };
                } else {
                    // Hide other states completely when focusing one
                    return { visible: false };
                }
            }
        }

        return { visible: false };
    });
}

function applyDataLayerStyle() {
    refreshMapStyles();
}

function updatePostalCodeStyle() {
    refreshMapStyles();
}

window.clearGeocodeCache = function () {
    if (confirm("This will clear all saved pincode locations and re-query Google Maps. Continue?")) {
        localStorage.removeItem('geocodeCache');
        geocodeCache = {};
        alert("Cache cleared. The map will now re-fetch locations with improved accuracy.");
        location.reload();
    }
}