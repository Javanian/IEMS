import { isManufacturing } from '../../config/appVariant';
import SalvagingSelectJobPage from './salvaging/SelectJobPage';
import ManufacturingSelectJobPage from './manufacturing/SelectJobPage';

export default function SelectJobPage() {
  return isManufacturing() ? <ManufacturingSelectJobPage /> : <SalvagingSelectJobPage />;
}
