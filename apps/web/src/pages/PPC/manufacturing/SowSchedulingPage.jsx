import React, { useState } from 'react';
import { Outlet, useLocation, useMatches, useNavigate } from 'react-router-dom';
import { PageHeader } from '../../../components';

export default function ManufacturingSchedulingLayout() {
  const navigate = useNavigate();
  const location = useLocation();
  const matches = useMatches();

  const [headerRight, setHeaderRight] = useState(null);

  const isIndex = location.pathname.replace(/\/+$/, '') === '/sow-scheduling';

  const active = [...matches].reverse().find((match) => match.handle?.title);
  const title = active?.handle?.title || 'SOW Scheduling';
  const eyebrow = active?.handle?.eyebrow || 'Manufacturing';

  return (
    <div className="flex h-screen w-full flex-col overflow-hidden bg-slate-50">
      <PageHeader
        eyebrow={eyebrow}
        title={title}
        backLabel={isIndex ? 'Operations Hub' : 'Menu'}
        onBack={isIndex ? () => navigate('/operations-hub') : () => navigate('/sow-scheduling')}
        right={headerRight}
      />

      {}
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
        <Outlet context={{ setHeaderRight }} />
      </div>
    </div>
  );
}
