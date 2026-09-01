import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { goBackOrFallback } from '../utils/navigation';
import {
  Settings,
  User,
  Wrench,
  Info,
  Circle,
  Save,
  RefreshCw,
  Trash2,
  Download,
  BookOpen,
  Mail,
  Link,
} from 'lucide-react';
import { PageContainer, AppHeader, Button, Switch, FormRow, Input, Select } from '../components';

const SettingPage = () => {
  const navigate = useNavigate();

  const [autoCheckout, setAutoCheckout] = useState(false);
  const [notifications, setNotifications] = useState(true);
  const [darkMode, setDarkMode] = useState(false);
  const [offlineMode, setOfflineMode] = useState(true);

  const handleSave = () => {
    console.log('Settings saved:', {
      autoCheckout,
      notifications,
      darkMode,
      offlineMode,
    });
    alert('Settings saved successfully!');
  };

  const handleReset = () => {
    setAutoCheckout(false);
    setNotifications(true);
    setDarkMode(false);
    setOfflineMode(true);
    alert('Settings reset to default!');
  };

  return (
    <PageContainer>
      <AppHeader
        title={
          <>
            <Settings className="inline w-5 h-5 mr-1.5" />
            Settings
          </>
        }
        rightContent={
          <Button variant="secondary" size="small" onClick={() => goBackOrFallback(navigate)}>
            ← Back
          </Button>
        }
      />

      {}
      <div className="bg-white rounded-xl p-6 shadow-md">
        <h3 className="font-bold text-lg text-gray-800 mb-4 flex items-center gap-2">
          <User className="w-5 h-5" /> User Profile
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <FormRow label="Employee ID">
            <Input value="EMP-001" disabled className="bg-gray-100" />
          </FormRow>
          <FormRow label="Full Name">
            <Input value="John Doe" />
          </FormRow>
          <FormRow label="Email">
            <Input type="email" value="john.doe@company.com" />
          </FormRow>
          <FormRow label="Phone">
            <Input type="tel" value="+62 812-3456-7890" />
          </FormRow>
          <FormRow label="Department">
            <Select
              value="production"
              options={[
                { value: 'production', label: 'Production' },
                { value: 'quality', label: 'Quality Control' },
                { value: 'maintenance', label: 'Maintenance' },
                { value: 'admin', label: 'Administration' },
              ]}
            />
          </FormRow>
          <FormRow label="Shift">
            <Select
              value="shift1"
              options={[
                { value: 'shift1', label: 'Shift 1 (07:00 - 15:00)' },
                { value: 'shift2', label: 'Shift 2 (15:00 - 23:00)' },
                { value: 'shift3', label: 'Shift 3 (23:00 - 07:00)' },
              ]}
            />
          </FormRow>
        </div>
        <div className="mt-4 flex gap-3">
          <Button variant="primary">Update Profile</Button>
          <Button variant="secondary">Change Password</Button>
        </div>
      </div>

      {}
      <div className="bg-white rounded-xl p-6 shadow-md">
        <h3 className="font-bold text-lg text-gray-800 mb-4 flex items-center gap-2">
          <Wrench className="w-5 h-5" /> Application Settings
        </h3>
        <div className="space-y-4">
          <div className="flex items-center justify-between p-4 bg-gray-50 rounded-lg">
            <div>
              <h4 className="font-semibold text-gray-800">Auto Check-out</h4>
              <p className="text-sm text-gray-600">Automatically check-out at end of shift</p>
            </div>
            <Switch checked={autoCheckout} onChange={setAutoCheckout} />
          </div>

          <div className="flex items-center justify-between p-4 bg-gray-50 rounded-lg">
            <div>
              <h4 className="font-semibold text-gray-800">Notifications</h4>
              <p className="text-sm text-gray-600">Enable push notifications for updates</p>
            </div>
            <Switch checked={notifications} onChange={setNotifications} />
          </div>

          <div className="flex items-center justify-between p-4 bg-gray-50 rounded-lg">
            <div>
              <h4 className="font-semibold text-gray-800">Dark Mode</h4>
              <p className="text-sm text-gray-600">Use dark theme for better night viewing</p>
            </div>
            <Switch checked={darkMode} onChange={setDarkMode} />
          </div>

          <div className="flex items-center justify-between p-4 bg-gray-50 rounded-lg">
            <div>
              <h4 className="font-semibold text-gray-800">Offline Mode</h4>
              <p className="text-sm text-gray-600">Cache data for offline access</p>
            </div>
            <Switch checked={offlineMode} onChange={setOfflineMode} />
          </div>
        </div>
      </div>

      {}
      <div className="bg-white rounded-xl p-6 shadow-md">
        <h3 className="font-bold text-lg text-gray-800 mb-4 flex items-center gap-2">
          <Info className="w-5 h-5" /> System Information
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="flex justify-between p-3 bg-gray-50 rounded-lg">
            <span className="text-gray-600">App Version</span>
            <span className="font-semibold text-gray-800">2.0.0</span>
          </div>
          <div className="flex justify-between p-3 bg-gray-50 rounded-lg">
            <span className="text-gray-600">Plant ID</span>
            <span className="font-semibold text-gray-800">5071</span>
          </div>
          <div className="flex justify-between p-3 bg-gray-50 rounded-lg">
            <span className="text-gray-600">Server Status</span>
            <span className="font-semibold text-green-600 flex items-center gap-1">
              <Circle className="w-3 h-3 fill-green-500 text-green-500" /> Online
            </span>
          </div>
          <div className="flex justify-between p-3 bg-gray-50 rounded-lg">
            <span className="text-gray-600">Last Sync</span>
            <span className="font-semibold text-gray-800">2 mins ago</span>
          </div>
          <div className="flex justify-between p-3 bg-gray-50 rounded-lg">
            <span className="text-gray-600">Cache Size</span>
            <span className="font-semibold text-gray-800">24.5 MB</span>
          </div>
          <div className="flex justify-between p-3 bg-gray-50 rounded-lg">
            <span className="text-gray-600">Database</span>
            <span className="font-semibold text-gray-800">PostgreSQL</span>
          </div>
        </div>
      </div>

      {}
      <div className="flex flex-wrap gap-3">
        <Button variant="primary" onClick={handleSave} className="flex-1 md:flex-none">
          <Save className="inline w-4 h-4 mr-1" />
          Save Settings
        </Button>
        <Button variant="warning" onClick={handleReset} className="flex-1 md:flex-none">
          <RefreshCw className="inline w-4 h-4 mr-1" />
          Reset to Default
        </Button>
        <Button variant="danger" className="flex-1 md:flex-none">
          <Trash2 className="inline w-4 h-4 mr-1" />
          Clear Cache
        </Button>
        <Button variant="secondary" className="flex-1 md:flex-none">
          <Download className="inline w-4 h-4 mr-1" />
          Export Settings
        </Button>
      </div>

      {}
      <div className="bg-gradient-to-br from-primary/10 to-primary/5 rounded-xl p-6 border border-primary/20">
        <div className="text-center">
          <h4 className="font-bold text-lg text-gray-800 mb-2">MPS Timesheet System</h4>
          <p className="text-sm text-gray-600 mb-3">
            Manufacturing Production System - Version 2.0.0
          </p>
          <p className="text-xs text-gray-500">© 2026 MPS Manufacturing. All rights reserved.</p>
          <div className="mt-4 flex justify-center gap-3">
            <Button variant="primary" size="small">
              <BookOpen className="inline w-4 h-4 mr-1" />
              Help
            </Button>
            <Button variant="secondary" size="small">
              <Mail className="inline w-4 h-4 mr-1" />
              Support
            </Button>
            <Button variant="secondary" size="small">
              <Link className="inline w-4 h-4 mr-1" />
              About
            </Button>
          </div>
        </div>
      </div>
    </PageContainer>
  );
};

export default SettingPage;
