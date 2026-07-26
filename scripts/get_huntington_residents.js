import https from 'https';
import fs from 'fs';

const url = "https://gisservices.its.ny.gov/arcgis/rest/services/NYS_Tax_Parcel_Centroid_Points/FeatureServer/0/query?where=LOC_ZIP%3D%2711743%27+AND+PROP_CLASS+LIKE+%272%25%27+AND+PRIMARY_OWNER+IS+NOT+NULL&outFields=OBJECTID,COUNTY_NAME,MUNI_NAME,LOC_ZIP,PARCEL_ADDR,LOC_ST_NBR,LOC_STREET,CITYTOWN_NAME,PROP_CLASS,PRINT_KEY,SBL,PRIMARY_OWNER,FULL_MARKET_VAL,ACRES&f=json&resultRecordCount=10&returnGeometry=true&outSR=4326";

https.get(url, (res) => {
  let body = '';
  res.on('data', chunk => body += chunk);
  res.on('end', () => {
    try {
      const data = JSON.parse(body);
      const records = (data.features || []).map(f => ({
        id: `SUFFOLK_${f.attributes.OBJECTID}`,
        owner: f.attributes.PRIMARY_OWNER,
        address: f.attributes.PARCEL_ADDR || `${f.attributes.LOC_ST_NBR || ''} ${f.attributes.LOC_STREET || ''}`.trim(),
        township: f.attributes.MUNI_NAME || f.attributes.CITYTOWN_NAME,
        zip: f.attributes.LOC_ZIP,
        county: f.attributes.COUNTY_NAME,
        sbl_parcel_key: f.attributes.PRINT_KEY || f.attributes.SBL,
        marketValue: f.attributes.FULL_MARKET_VAL ? `$${Number(f.attributes.FULL_MARKET_VAL).toLocaleString()}` : 'N/A',
        propertyClass: `210 - Single Family Residential`,
        acres: f.attributes.ACRES,
        coordinates: { lat: f.geometry?.y, lng: f.geometry?.x }
      }));
      console.log(JSON.stringify(records, null, 2));
    } catch(e) {
      console.error("Parse error:", e, body.substring(0, 200));
    }
  });
});
