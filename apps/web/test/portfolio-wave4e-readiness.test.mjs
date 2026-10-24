import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { editWmsField } from './portfolio-wave4b-wms-browser.mjs';

test('WMS field edit waits for the asynchronously rendered enabled destination selector', async () => {
  let ready = false;
  const events = [];
  class Select {
    set value(value) { this.selected = value; }
    dispatchEvent(event) { events.push(event.type); }
  }
  const control = new Select();
  control.tagName = 'SELECT';
  control.disabled = false;
  const form = {
    querySelector(selector) {
      if (selector === 'h2') return { textContent: 'Transfer whole receipt' };
      return ready ? control : null;
    },
  };
  const context = {
    document: { querySelectorAll: () => [form] },
    HTMLSelectElement: Select,
    HTMLInputElement: class {},
    Event: class { constructor(type) { this.type = type; } },
  };
  await editWmsField({
    wait: async predicate => {
      assert.equal(Boolean(vm.runInNewContext(predicate, context)), false);
      ready = true;
      assert.equal(Boolean(vm.runInNewContext(predicate, context)), true);
    },
    evaluate: expression => vm.runInNewContext(expression, context),
  }, 'Transfer whole receipt', 'binId', 'persisted-bin-id');
  assert.equal(control.selected, 'persisted-bin-id');
  assert.deepEqual(events, ['input', 'change']);
});
