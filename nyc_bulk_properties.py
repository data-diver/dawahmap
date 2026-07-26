#!/usr/bin/env python3
"""
NYC Bulk Property Data Extractor
Uses NYC Open Data APIs to get comprehensive property and owner information by zip code
"""

import requests
import pandas as pd
import logging
from typing import List, Dict, Optional
import json
import time

# Configure logging
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

class NYCPropertyExtractor:
    def __init__(self):
        self.session = requests.Session()
        self.session.headers.update({
            'User-Agent': 'NYC Property Extractor 1.0',
            'Accept': 'application/json'
        })
    
    def get_properties_by_zip(self, zip_code: str, limit: int = 1000) -> Optional[List[Dict]]:
        """
        Get property information by zip code using NYC Open Data APIs
        
        NYC Property Assessment Data: https://data.cityofnewyork.us/Housing-Development/Property-Valuation-and-Assessment-Data/rgy2-tti8
        """
        try:
            # NYC Open Data SODA API endpoint for Property Assessment data
            url = "https://data.cityofnewyork.us/resource/rgy2-tti8.json"
            
            params = {
                'zipcode': zip_code,
                '$limit': limit,
                '$order': 'block,lot'
            }
            
            logger.info(f"Fetching properties for zip code {zip_code}...")
            response = self.session.get(url, params=params)
            response.raise_for_status()
            
            properties = response.json()
            logger.info(f"Found {len(properties)} properties in zip code {zip_code}")
            
            return properties
            
        except Exception as e:
            logger.error(f"Failed to fetch properties from NYC Open Data: {str(e)}")
            return None
    
    def get_property_owners_by_zip(self, zip_code: str) -> Optional[List[Dict]]:
        """
        Get detailed property owner information by zip code
        
        Uses NYC Rolling Sales Data: https://data.cityofnewyork.us/City-Government/NYC-Citywide-Rolling-Calendar-Sales/usep-8jbt
        """
        try:
            # NYC Rolling Sales data (contains owner info)
            url = "https://data.cityofnewyork.us/resource/usep-8jbt.json"
            
            params = {
                'zip_code': zip_code,
                '$limit': 1000,
                '$order': 'neighborhood'
            }
            
            logger.info(f"Fetching owner information for zip code {zip_code}...")
            response = self.session.get(url, params=params)
            response.raise_for_status()
            
            sales_data = response.json()
            logger.info(f"Found {len(sales_data)} sales records with owner info")
            
            return sales_data
            
        except Exception as e:
            logger.error(f"Failed to fetch owner data: {str(e)}")
            return None
    
    def get_comprehensive_property_data(self, zip_code: str) -> Dict:
        """
        Get comprehensive property and owner data for a zip code
        """
        results = {
            'zip_code': zip_code,
            'properties': [],
            'owners': [],
            'summary': {}
        }
        
        # Get property assessment data
        properties = self.get_properties_by_zip(zip_code)
        if properties:
            results['properties'] = properties
            
            # Extract unique owners
            owners = []
            for prop in properties:
                if 'owner_name' in prop and prop['owner_name']:
                    owner_info = {
                        'owner_name': prop['owner_name'],
                        'address': f"{prop.get('address', '')}",
                        'bbl': prop.get('bbl', ''),
                        'block': prop.get('block', ''),
                        'lot': prop.get('lot', ''),
                        'building_class': prop.get('building_class_at_time_of_sale', ''),
                        'assessed_value': prop.get('assessed_total', '')
                    }
                    owners.append(owner_info)
            
            results['owners'] = owners
            results['summary'] = {
                'total_properties': len(properties),
                'total_owners': len(owners),
                'unique_owners': len(set(owner['owner_name'] for owner in owners if owner['owner_name']))
            }
        
        # Get additional owner data from sales records
        sales_data = self.get_property_owners_by_zip(zip_code)
        if sales_data:
            logger.info(f"Processing {len(sales_data)} sales records for owner information")
            for sale in sales_data:
                # Extract all available owner information from sales data
                owner_info = {
                    'buyer': sale.get('buyer', ''),
                    'seller': sale.get('seller', ''), 
                    'address': sale.get('address', ''),
                    'apartment_number': sale.get('apartment_number', ''),
                    'sale_price': sale.get('sale_price', ''),
                    'sale_date': sale.get('sale_date', ''),
                    'building_class': sale.get('building_class_at_time_of_sale', ''),
                    'building_type': sale.get('building_class_category', ''),
                    'neighborhood': sale.get('neighborhood', ''),
                    'borough': sale.get('borough', ''),
                    'block': sale.get('block', ''),
                    'lot': sale.get('lot', ''),
                    'zip_code': sale.get('zip_code', ''),
                    'residential_units': sale.get('residential_units', ''),
                    'commercial_units': sale.get('commercial_units', ''),
                    'total_units': sale.get('total_units', ''),
                    'land_square_feet': sale.get('land_square_feet', ''),
                    'gross_square_feet': sale.get('gross_square_feet', ''),
                    'year_built': sale.get('year_built', '')
                }
                results['owners'].append(owner_info)
            
            # Update summary with sales data
            results['summary']['sales_records'] = len(sales_data)
            unique_buyers = len(set(sale.get('buyer', '') for sale in sales_data if sale.get('buyer')))
            unique_sellers = len(set(sale.get('seller', '') for sale in sales_data if sale.get('seller')))
            results['summary']['unique_buyers'] = unique_buyers
            results['summary']['unique_sellers'] = unique_sellers
        
        return results
    
    def save_to_file(self, data: Dict, filename: str):
        """Save data to JSON file"""
        try:
            with open(filename, 'w') as f:
                json.dump(data, f, indent=2, default=str)
            logger.info(f"Data saved to {filename}")
        except Exception as e:
            logger.error(f"Failed to save data: {str(e)}")
    
    def print_summary(self, data: Dict):
        """Print a formatted summary of the data"""
        zip_code = data.get('zip_code', 'Unknown')
        summary = data.get('summary', {})
        
        print(f"\n{'='*60}")
        print(f"PROPERTY SUMMARY FOR ZIP CODE {zip_code}")
        print(f"{'='*60}")
        print(f"Total Properties: {summary.get('total_properties', 0)}")
        print(f"Sales Records: {summary.get('sales_records', 0)}")
        print(f"Unique Buyers: {summary.get('unique_buyers', 0)}")
        print(f"Unique Sellers: {summary.get('unique_sellers', 0)}")
        print(f"{'='*60}")
        
        # Show first 10 properties
        properties = data.get('properties', [])
        if properties:
            print(f"\nFIRST 10 PROPERTIES:")
            print(f"{'-'*60}")
            for i, prop in enumerate(properties[:10], 1):
                owner = prop.get('owner_name', 'Unknown Owner')
                address = prop.get('address', 'Unknown Address')
                bbl = prop.get('bbl', 'Unknown BBL')
                print(f"{i:2d}. Owner: {owner}")
                print(f"    Address: {address}")
                print(f"    BBL: {bbl}")
                print()
        
        # Show sales/owner information from sales records
        owners = data.get('owners', [])
        if owners:
            print(f"\nRECENT PROPERTY TRANSACTIONS (First 20):")
            print(f"{'-'*80}")
            for i, owner_record in enumerate(owners[:20], 1):
                buyer = owner_record.get('buyer', 'Unknown Buyer')
                seller = owner_record.get('seller', 'Unknown Seller')
                address = owner_record.get('address', 'Unknown Address')
                price = owner_record.get('sale_price', 'Unknown Price')
                date = owner_record.get('sale_date', 'Unknown Date')
                
                print(f"{i:2d}. Transaction at: {address}")
                print(f"    Buyer: {buyer}")
                print(f"    Seller: {seller}")
                print(f"    Sale Price: ${price}")
                print(f"    Sale Date: {date}")
                print()
        
        # Show unique buyers (current property owners from recent sales)
        unique_buyers = {}
        for owner_record in owners:
            buyer = owner_record.get('buyer', '')
            if buyer and buyer.strip():
                if buyer not in unique_buyers:
                    unique_buyers[buyer] = []
                unique_buyers[buyer].append(owner_record)
        
        if unique_buyers:
            print(f"\nUNIQUE PROPERTY BUYERS/OWNERS ({len(unique_buyers)} total):")
            print(f"{'-'*80}")
            for i, (buyer_name, transactions) in enumerate(list(unique_buyers.items())[:25], 1):
                print(f"{i:2d}. {buyer_name} ({len(transactions)} transactions)")
                for trans in transactions[:2]:  # Show up to 2 transactions per buyer
                    address = trans.get('address', 'Unknown')
                    price = trans.get('sale_price', 'Unknown')
                    print(f"    → {address} (${price})")
                if len(transactions) > 2:
                    print(f"    → ... and {len(transactions) - 2} more transactions")
                print()


def main():
    extractor = NYCPropertyExtractor()
    
    # Search for properties in zip code 11418
    zip_code = "11414"
    logger.info(f"Starting comprehensive property search for zip code {zip_code}")
    
    # Get comprehensive data
    data = extractor.get_comprehensive_property_data(zip_code)
    
    # Print summary
    extractor.print_summary(data)
    
    # Save to file
    filename = f"properties_{zip_code}.json"
    extractor.save_to_file(data, filename)
    
    print(f"\n📄 Complete data saved to: {filename}")
    print(f"🔍 You can analyze this file for detailed property and owner information")


if __name__ == "__main__":
    main()