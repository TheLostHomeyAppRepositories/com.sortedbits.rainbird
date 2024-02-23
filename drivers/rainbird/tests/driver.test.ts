// import { PairSession } from 'homey/lib/PairSession';

import * as RainBirdDriver from '../driver';

describe('onRepair', () => {
    test('perform a zone name update', async () => {
        console.log(RainBirdDriver);
        // const driver = new RainBirdDriver();
        const test = false;
        // const session = new PairSession();

        // const result = await driver.onRepair(session, {});

        // await session.emit('zone_name_update', {});

        expect(test).toEqual({ success: true });

        // expect(driver.zoneNameUpdate).toHaveBeenCalledTimes(1);
    });
});
