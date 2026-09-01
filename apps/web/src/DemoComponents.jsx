import { useState } from 'react';
import {
  PageContainer,
  AppHeader,
  MenuGrid,
  Button,
  InfoBox,
  MachineCard,
  Switch,
  Gallery,
  TimesheetTable,
  Input,
  FormRow,
  Select,
  SearchRow,
  TextBox,
} from './components';

function App() {
  const [isCheckedIn, setIsCheckedIn] = useState(false);
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

  const machines = [
    {
      code: 'M001',
      name: 'CNC Machine 1',
      status: 'Active',
      operator: 'John Doe',
    },
    {
      code: 'M002',
      name: 'Lathe Machine',
      status: 'Idle',
      operator: 'Jane Smith',
    },
  ];

  return (
    <PageContainer>
      <AppHeader
        title="MPS Timesheet System"
        rightContent={
          <Button variant="secondary" size="small">
            Logout
          </Button>
        }
      />

      <div className="flex flex-col md:flex-row gap-3 h-full">
        {}
        <div className="flex-1">
          <InfoBox
            items={infoItems}
            actions={
              <div className="grid grid-cols-2 gap-2.5 w-full min-h-[50%]">
                <Button variant="success" size="small2">
                  Check In
                </Button>
                <Button variant="danger" size="small2">
                  Check Out
                </Button>
                <Button variant="primary" size="small2">
                  Scan Barcode
                </Button>
                <Button variant="warning" size="small2">
                  History
                </Button>
              </div>
            }
          />
        </div>

        {}
        <div className="flex-1">
          <MenuGrid>
            <Button variant="primary" size="icon">
              Main Menu
            </Button>
            <Button variant="success" size="icon">
              Timesheet
            </Button>
            <Button variant="warning" size="icon">
              Reports
            </Button>
            <Button variant="danger" size="icon">
              Settings
            </Button>
          </MenuGrid>
        </div>
      </div>

      {}
      <div className="bg-white p-4 rounded-xl border border-gray-300 space-y-3">
        <h3 className="font-bold text-lg mb-3">Form Components Demo</h3>

        <SearchRow
          value={searchValue}
          onChange={(e) => setSearchValue(e.target.value)}
          placeholder="Cari production order..."
        />

        <FormRow label="Production Order">
          <Input placeholder="Masukkan PO Number..." />
        </FormRow>

        <FormRow label="Work Center">
          <Select
            options={[
              { value: 'wc1', label: 'Work Center 1' },
              { value: 'wc2', label: 'Work Center 2' },
            ]}
            placeholder="Pilih Work Center"
          />
        </FormRow>

        <FormRow label="Quantity" uom="pcs">
          <Input type="number" placeholder="0" />
        </FormRow>

        <div className="flex items-center gap-3">
          <Switch checked={isCheckedIn} onChange={setIsCheckedIn} label="Auto Check-in" />
        </div>
      </div>

      {}
      <div className="bg-white p-4 rounded-xl border border-gray-300 flex-1 overflow-hidden flex flex-col">
        <h3 className="font-bold text-lg mb-3">Timesheet History</h3>
        <TimesheetTable
          data={timesheetData}
          onEdit={(row) => console.log('Edit:', row)}
          onDelete={(row) => console.log('Delete:', row)}
        />
      </div>

      {}
      <div className="bg-white p-4 rounded-xl border border-gray-300">
        <h3 className="font-bold text-lg mb-3">Machine Status</h3>
        <div className="grid grid-cols-[repeat(auto-fill,minmax(260px,1fr))] gap-4">
          {machines.map((machine, index) => (
            <MachineCard
              key={index}
              title={machine.code}
              details={[
                { label: 'Name', value: machine.name },
                { label: 'Status', value: machine.status },
                { label: 'Operator', value: machine.operator },
              ]}
              onClick={() => console.log('Machine clicked:', machine)}
            />
          ))}
        </div>
      </div>

      {}
      <div className="bg-white p-4 rounded-xl border border-gray-300">
        <h3 className="font-bold text-lg mb-3">Text Box Variants</h3>
        <div className="flex gap-2 flex-wrap">
          <TextBox variant="order">PO-12345</TextBox>
          <TextBox variant="seq">010</TextBox>
          <TextBox variant="hrs">8.5 hrs</TextBox>
          <TextBox variant="act">Assembly Operation</TextBox>
          <TextBox variant="wct">WC-001</TextBox>
        </div>
      </div>
    </PageContainer>
  );
}

export default App;
