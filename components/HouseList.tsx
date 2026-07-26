
import React from 'react';
import { House, VisitStatus } from '../types';
import { User, MapPin, Search, List as ListIcon } from 'lucide-react';
import { FixedSizeList as List, ListChildComponentProps } from 'react-window';
import AutoSizer from 'react-virtualized-auto-sizer';

interface HouseListProps {
  houses: House[];
  onSelectHouse: (house: House) => void;
  selectedHouseId: string | null;
  isOpen: boolean;
  onToggle: () => void;
  searchQuery: string;
  onSearchChange: (val: string) => void;
}

const Row = ({ index, style, data }: ListChildComponentProps<{ 
  houses: House[], 
  selectedHouseId: string | null,
  onSelectHouse: (house: House) => void,
  onToggle: () => void 
}>) => {
  const { houses, selectedHouseId, onSelectHouse, onToggle } = data;
  const house = houses[index];
  const isActive = house.id === selectedHouseId;

  return (
    <div style={style} className="px-3 py-1.5">
      <button 
        onClick={() => {
          onSelectHouse(house);
          if (window.innerWidth < 1024) {
            onToggle();
          }
        }}
        className={`w-full text-left h-full p-3 rounded-xl shadow-sm border transition-all active:scale-[0.98] flex items-start gap-3 ${
          isActive 
            ? 'bg-emerald-50 border-emerald-500 shadow-md' 
            : 'bg-white border-gray-100 hover:border-emerald-200 hover:shadow-md'
        }`}
      >
        <div className={`w-3 h-3 rounded-full mt-1.5 shrink-0 ${
          house.status === VisitStatus.TODO ? 'bg-slate-300' : 
          house.status === VisitStatus.VISITED ? 'bg-emerald-500' : 
          house.status === VisitStatus.REVISIT ? 'bg-amber-400' : 'bg-rose-500'
        }`} />
        
        <div className="flex-1 min-w-0">
          <h3 className="font-bold text-gray-900 text-sm truncate leading-tight mb-1">
            {house.address}
          </h3>
          <div className="flex items-center gap-1.5 text-emerald-700 font-semibold mb-1">
            <User className="w-3.5 h-3.5" />
            <span className="text-xs truncate">{house.owner || 'Unnamed Resident'}</span>
          </div>
          <div className="flex items-center gap-1.5 text-gray-400">
            <MapPin className="w-3 h-3 shrink-0" />
            <span className="text-[11px] truncate">{house.street || 'Nearby Area'}</span>
          </div>
        </div>
      </button>
    </div>
  );
};

const HouseList: React.FC<HouseListProps> = ({ 
  houses, onSelectHouse, selectedHouseId, isOpen, onToggle, searchQuery, onSearchChange 
}) => {
  return (
    <div 
      className={`fixed left-0 top-0 bottom-0 z-[40] transition-transform duration-300 ease-in-out transform flex flex-col
        ${isOpen ? 'translate-x-0' : '-translate-x-full'} 
        w-[85%] sm:w-[380px] bg-white/95 backdrop-blur-md shadow-2xl border-r border-gray-200`}
    >
      {/* Header */}
      <div className="p-4 bg-emerald-600 text-white shadow-sm shrink-0">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <ListIcon className="w-5 h-5" />
            <h2 className="font-bold text-lg">In View ({houses.length})</h2>
          </div>
          <button 
            onClick={onToggle}
            className="p-2 hover:bg-emerald-700 rounded-full transition-colors focus:outline-none"
            aria-label="Close list"
          >
            <span className="text-2xl leading-none">×</span>
          </button>
        </div>
        
        <div className="relative">
          <input 
            type="text" 
            placeholder="Search visible list..." 
            className="w-full bg-emerald-700/50 border border-emerald-400/30 text-white placeholder:text-emerald-100/70 text-sm rounded-lg py-2.5 pl-9 pr-4 outline-none focus:ring-2 focus:ring-white/20" 
            value={searchQuery} 
            onChange={(e) => onSearchChange(e.target.value)}
          />
          <Search className="w-4 h-4 absolute left-3 top-3.5 text-emerald-100/70" />
        </div>
      </div>

      {/* Virtualized List Body */}
      <div className="flex-1 bg-slate-50 relative">
        {houses.length === 0 ? (
          <div className="text-center py-10 px-4">
            <div className="text-gray-300 mb-2">No properties in this area</div>
            <p className="text-xs text-gray-400">Pan the map or zoom out to see more.</p>
          </div>
        ) : (
          <AutoSizer>
            {({ height, width }) => (
              <List
                height={height}
                width={width}
                itemCount={houses.length}
                itemSize={100} // Fixed height for each row
                itemData={{ houses, selectedHouseId, onSelectHouse, onToggle }}
                className="custom-scroll"
              >
                {Row}
              </List>
            )}
          </AutoSizer>
        )}
      </div>
    </div>
  );
};

export default HouseList;
