import http from 'http';

function fetchUrl(url) {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, data: JSON.parse(body) });
        } catch (e) {
          reject(new Error(`Failed to parse JSON from ${url}: ${e.message}`));
        }
      });
    }).on('error', reject);
  });
}

async function runTests() {
  console.log("=== DAWAHMAP SUFFOLK & NYC INTEGRATION TEST SUITE ===");

  // 1. Health check
  try {
    const health = await fetchUrl('http://localhost:3000/api/health');
    console.log("✅ Health Check Passed:", health.data);
  } catch (err) {
    console.error("❌ Health Check Failed:", err.message);
    process.exit(1);
  }

  // 2. NYC Zip Code Test (10001)
  try {
    console.log("\nTesting NYC Zip 10001...");
    const nycRes = await fetchUrl('http://localhost:3000/api/properties?zip=10001');
    if (nycRes.data.status === 'success' && nycRes.data.count > 0) {
      const sample = nycRes.data.houses[0];
      console.log(`✅ NYC Zip 10001 Passed! Count: ${nycRes.data.count}, Source: ${nycRes.data.source}`);
      console.log(`   Sample: ID=${sample.id}, Address="${sample.address}", Owner="${sample.owner}", Lat=${sample.lat}, Lng=${sample.lng}`);
    } else {
      console.error("❌ NYC Zip 10001 returned 0 properties or unexpected format:", nycRes.data);
    }
  } catch (err) {
    console.error("❌ NYC Zip Test Failed:", err.message);
  }

  // 3. Suffolk County Zips Test (11743 Huntington, 11725 Commack, 11768 Northport)
  const suffolkZips = [
    { zip: '11743', name: 'Huntington' },
    { zip: '11725', name: 'Commack' },
    { zip: '11768', name: 'Northport' },
    { zip: '11901', name: 'Riverhead' }
  ];

  for (const item of suffolkZips) {
    try {
      console.log(`\nTesting Suffolk County Zip ${item.zip} (${item.name})...`);
      const res = await fetchUrl(`http://localhost:3000/api/properties?zip=${item.zip}&area=${encodeURIComponent(item.name)}`);
      if (res.data.status === 'success' && res.data.count > 0) {
        const sample = res.data.houses[0];
        console.log(`✅ Suffolk Zip ${item.zip} (${item.name}) Passed! Count: ${res.data.count}, Source: ${res.data.source}`);
        console.log(`   Sample: ID=${sample.id}, Address="${sample.address}", Owner="${sample.owner}", Lat=${sample.lat}, Lng=${sample.lng}`);
        
        // Validate coordinates bounds for Suffolk County
        if (sample.lat >= 40.5 && sample.lat <= 41.3 && sample.lng >= -73.5 && sample.lng <= -71.8) {
          console.log(`   Coordinates (${sample.lat}, ${sample.lng}) are within valid Suffolk County GIS bounding box.`);
        } else {
          console.warn(`   ⚠️ Warning: Coordinates (${sample.lat}, ${sample.lng}) outside expected Suffolk range.`);
        }
      } else {
        console.error(`❌ Suffolk Zip ${item.zip} returned 0 properties or unexpected format:`, res.data);
      }
    } catch (err) {
      console.error(`❌ Suffolk Zip ${item.zip} Test Failed:`, err.message);
    }
  }

  console.log("\n=== ALL INTEGRATION TESTS COMPLETED ===");
}

runTests();
