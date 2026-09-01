import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { goBackOrFallback } from '../../utils/navigation';
import { ClipboardList, Camera, BarChart2 } from 'lucide-react';
import {
  PageContainer,
  AppHeader,
  Button,
  InfoBox,
  TimesheetTable,
  SearchRow,
} from '../../components';

const TimesheetPage = () => {
  const navigate = useNavigate();
  const [searchValue, setSearchValue] = useState('');

  const infoItems = [
    { label: 'Production Order', value: 'PO-12345' },
    { label: 'Serial Number', value: 'SN-67890' },
    { label: 'Nama Lengkap', value: 'John Doe' },
    { label: 'Operasi', value: 'Assembling' },
  ];

  const timesheetData = [
    {
      date: '05/02/2026',
      operation: 'Assembly Line 1',
      checkinDate: '05/02/2026',
      checkinTime: '08:00',
      checkoutDate: '05/02/2026',
      checkoutTime: '17:00',
      duration: '9 jam',
    },
    {
      date: '04/02/2026',
      operation: 'Quality Check',
      checkinDate: '04/02/2026',
      checkinTime: '08:30',
      checkoutDate: '04/02/2026',
      checkoutTime: '16:30',
      duration: '8 jam',
    },
  ];

  const handleEdit = (row) => {
    console.log('Edit:', row);
  };

  const handleDelete = (row) => {
    console.log('Delete:', row);
  };

  return (
    <PageContainer>
      <AppHeader
        title={
          <>
            <ClipboardList className="inline w-5 h-5 mr-1.5" />
            Timesheet
          </>
        }
        rightContent={
          <Button variant="secondary" size="small" onClick={() => goBackOrFallback(navigate)}>
            ← Back
          </Button>
        }
      />

      {}
      <div className="flex flex-col lg:flex-row gap-4">
        <div className="flex-1">
          <InfoBox
            items={infoItems}
            actions={
              <div className="grid grid-cols-2 gap-2.5 w-full min-h-[120px]">
                <Button variant="success" size="small2">
                  Check In
                </Button>
                <Button variant="danger" size="small2">
                  Check Out
                </Button>
                <Button variant="primary" size="small2">
                  <Camera className="inline w-4 h-4 mr-1" />
                  Scan Barcode
                </Button>
                <Button variant="warning" size="small2">
                  <BarChart2 className="inline w-4 h-4 mr-1" />
                  Reports
                </Button>
              </div>
            }
          />
        </div>

        {}
        <div className="lg:w-80 bg-white rounded-xl p-4 shadow-md border border-gray-200">
          <h3 className="font-bold text-gray-800 mb-3">Today's Summary</h3>
          <div className="space-y-3">
            <div className="flex justify-between items-center p-2 bg-blue-50 rounded-lg">
              <span className="text-sm text-gray-600">Total Hours</span>
              <span className="text-lg font-bold text-primary">8.5h</span>
            </div>
            <div className="flex justify-between items-center p-2 bg-green-50 rounded-lg">
              <span className="text-sm text-gray-600">Check-ins</span>
              <span className="text-lg font-bold text-success">3</span>
            </div>
            <div className="flex justify-between items-center p-2 bg-orange-50 rounded-lg">
              <span className="text-sm text-gray-600">Active Now</span>
              <span className="text-lg font-bold text-orange-500">Yes</span>
            </div>
          </div>
        </div>
      </div>

      {}
      <div className="bg-white rounded-xl p-4 shadow-md">
        <SearchRow
          value={searchValue}
          onChange={(e) => setSearchValue(e.target.value)}
          placeholder="Cari berdasarkan PO, operasi, atau tanggal..."
          onSearch={() => console.log('Search:', searchValue)}
        />
      </div>

      {}
      <div className="bg-white rounded-xl p-4 shadow-md flex-1 overflow-hidden flex flex-col">
        <div className="flex justify-between items-center mb-4">
          <h3 className="font-bold text-lg text-gray-800">Timesheet History</h3>
          <div className="flex gap-2">
            <Button variant="primary" size="small">
              Export
            </Button>
            <Button variant="secondary" size="small">
              Filter
            </Button>
          </div>
        </div>
        <TimesheetTable data={timesheetData} onEdit={handleEdit} onDelete={handleDelete} />
      </div>
    </PageContainer>
  );
};

export default TimesheetPage;
