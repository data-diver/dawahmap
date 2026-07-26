import React, { useState } from 'react';
import { House, VisitStatus } from '../types';
import { X, CheckCircle, Clock, XCircle, RotateCcw, FileText } from 'lucide-react';

interface HouseDetailModalProps {
  house: House | null;
  onClose: () => void;
  onUpdate: (id: string, updates: Partial<House>) => void;
}

const HouseDetailModal: React.FC<HouseDetailModalProps> = ({ house, onClose, onUpdate }) => {
  if (!house) return null;

  const [noteText, setNoteText] = useState('');

  const handleStatusChange = (status: VisitStatus) => {
    onUpdate(house.id, { 
      status, 
      lastUpdated: Date.now() 
    });
  };

  const handleAddNote = (e: React.FormEvent) => {
    e.preventDefault();
    if (!noteText.trim()) return;

    const newNote = { text: noteText, date: new Date().toISOString() };
    const updatedNotes = house.notes ? [...house.notes, newNote] : [newNote];

    onUpdate(house.id, { notes: updatedNotes });
    setNoteText('');
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center pointer-events-none" onClick={onClose}>
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm pointer-events-auto transition-opacity" />
      
      <div 
        className="bg-white w-full sm:max-w-md rounded-t-2xl sm:rounded-2xl shadow-2xl p-6 pointer-events-auto transform animate-slide-up max-h-[85vh] flex flex-col"
        onClick={e => e.stopPropagation()}
      >
        
        {/* Header */}
        <div className="flex justify-between items-start mb-4 shrink-0">
          <div>
            <h2 className="text-2xl font-bold text-gray-800">{house.address}</h2>
            <p className="text-emerald-600 font-medium">{house.owner} • {house.street}</p>
          </div>
          <button onClick={onClose} className="p-2 bg-gray-100 rounded-full hover:bg-gray-200">
            <X className="w-5 h-5 text-slate-500" />
          </button>
        </div>

        <div className="overflow-y-auto custom-scroll pr-2 flex-1">
          {/* Status Actions */}
          <div className="grid grid-cols-2 gap-3 mb-6">
            <button 
              onClick={() => handleStatusChange(VisitStatus.VISITED)}
              className={`p-3 rounded-lg border-2 flex flex-col items-center transition-colors ${house.status === VisitStatus.VISITED ? 'border-green-500 bg-green-50 text-green-700' : 'border-gray-200 hover:border-green-100'}`}
            >
              <CheckCircle className={`w-6 h-6 mb-2 ${house.status === VisitStatus.VISITED ? 'text-green-500' : 'text-gray-400'}`} />
              <span className="text-xs font-bold">Visited</span>
            </button>

            <button 
              onClick={() => handleStatusChange(VisitStatus.REVISIT)}
              className={`p-3 rounded-lg border-2 flex flex-col items-center transition-colors ${house.status === VisitStatus.REVISIT ? 'border-yellow-500 bg-yellow-50 text-yellow-700' : 'border-gray-200 hover:border-yellow-100'}`}
            >
              <Clock className={`w-6 h-6 mb-2 ${house.status === VisitStatus.REVISIT ? 'text-yellow-500' : 'text-gray-400'}`} />
              <span className="text-xs font-bold">Re-Visit</span>
            </button>

            <button 
              onClick={() => handleStatusChange(VisitStatus.NOT_INTERESTED)}
              className={`p-3 rounded-lg border-2 flex flex-col items-center transition-colors ${house.status === VisitStatus.NOT_INTERESTED ? 'border-red-500 bg-red-50 text-red-700' : 'border-gray-200 hover:border-red-100'}`}
            >
              <XCircle className={`w-6 h-6 mb-2 ${house.status === VisitStatus.NOT_INTERESTED ? 'text-red-500' : 'text-gray-400'}`} />
              <span className="text-xs font-bold">No Interest</span>
            </button>

            <button 
              onClick={() => handleStatusChange(VisitStatus.TODO)}
              className={`p-3 rounded-lg border-2 flex flex-col items-center transition-colors ${house.status === VisitStatus.TODO ? 'border-slate-400 bg-slate-50 text-slate-700' : 'border-gray-200 hover:border-slate-300'}`}
            >
              <RotateCcw className={`w-6 h-6 mb-2 ${house.status === VisitStatus.TODO ? 'text-slate-500' : 'text-gray-400'}`} />
              <span className="text-xs font-bold">Reset</span>
            </button>
          </div>

          {/* Notes Section */}
          <div className="mb-6">
            <h4 className="text-sm font-semibold text-gray-700 mb-2 flex items-center gap-2">
              <FileText className="w-4 h-4"/> Notes
            </h4>
            
            <form onSubmit={handleAddNote} className="flex gap-2 mb-4">
              <input 
                type="text" 
                value={noteText}
                onChange={(e) => setNoteText(e.target.value)}
                placeholder="Add note..." 
                className="flex-1 bg-gray-50 border border-gray-300 text-gray-900 text-sm rounded-lg p-2 focus:ring-2 focus:ring-emerald-500 outline-none"
              />
              <button 
                type="submit" 
                className="bg-emerald-600 hover:bg-emerald-700 text-white font-medium rounded-lg text-sm px-4 py-2"
              >
                Add
              </button>
            </form>

            <div className="space-y-2">
              {(house.notes || []).slice().reverse().map((note, idx) => (
                <div key={idx} className="bg-gray-50 p-2 rounded border-l-2 border-emerald-400">
                  <p className="text-sm text-gray-800 break-words">{note.text}</p>
                  <p className="text-[10px] text-gray-400 mt-1">{new Date(note.date).toLocaleString()}</p>
                </div>
              ))}
              {(house.notes || []).length === 0 && (
                <p className="text-xs text-slate-400 italic">No notes added yet.</p>
              )}
            </div>
          </div>
        </div>
        
      </div>
    </div>
  );
};

export default HouseDetailModal;
