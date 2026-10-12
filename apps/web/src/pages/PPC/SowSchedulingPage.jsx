import { isManufacturing } from '../../config/appVariant';
import ManufacturingSchedulingLayout from './manufacturing/SowSchedulingPage';
import SalvagingSowSchedulingPage from './salvaging/SowSchedulingPage';

export default function SowSchedulingPage() {
  return isManufacturing() ? <ManufacturingSchedulingLayout /> : <SalvagingSowSchedulingPage />;
}
