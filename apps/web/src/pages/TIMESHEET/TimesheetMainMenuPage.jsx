import { isManufacturing } from '../../config/appVariant';
import SalvagingTimesheetMainMenu from './salvaging/TimesheetMainMenuPage';
import ManufacturingTimesheetMainMenu from './manufacturing/TimesheetMainMenuPage';

export default function TimesheetMainMenuPage() {
  return isManufacturing() ? <ManufacturingTimesheetMainMenu /> : <SalvagingTimesheetMainMenu />;
}
