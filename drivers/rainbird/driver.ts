import Homey from 'homey';
import { PairSession } from 'homey/lib/Driver';

import { Zone } from './zone.js';

interface PairResult {
  success: boolean,
  model?: string,
  zones?: number[]
}

interface PairData {
  host: string,
  password: string,
  enableQueueing: boolean,
  defaultIrrigationTime: number
}

class MyDriver extends Homey.Driver {

  pairData: PairData | undefined;
  pairResult: PairResult | undefined;
  zoneNames: Record<number, string> = {};

  /**
   * onInit is called when the driver is initialized.
   */
  async onInit() {
    this.log('Rainbird has been initialized');
  }

  async connect(data: PairData): Promise<PairResult> {
    // eslint-disable-next-line node/no-unsupported-features/es-syntax
    const serviceType = await import('rainbird/dist/RainBird/RainBirdService.js');
    // Your code that uses RainBirdService goes here
    const { RainBirdService } = serviceType;

    const service = new RainBirdService({
      address: data.host,
      password: data.password,
      syncTime: false,
      showRequestResponse: true,
      refreshRate: 0,
    });

    const metadata = await service.init();

    /*
    const { client } = service;

    const model = await client.getModelAndVersion(false);
    const zones = await client.getAvailableZones(false);
    */
    if (metadata.model === undefined || metadata.zones === undefined) {
      return {
        success: false,
      };
    }
    return {
      success: true,
      zones: metadata.zones,
      model: metadata.model,
    };
  }

  async onPair(session: PairSession) {
    session.setHandler('form_complete', async (data) => {
      if (data.host && data.password) {
        this.pairData = data as PairData;

        this.pairResult = await this.connect(this.pairData as PairData);

        if (!this.pairResult.success) {
          return this.pairResult;
        }
        await session.nextView();
        return this.pairResult;
      }
      return {
        success: false,
      };
    });

    session.setHandler('update_zone_names', async (data) => {
      this.zoneNames = data;
    });

    session.setHandler('list_devices', async () => {
      if (this.pairData && this.pairResult && this.pairResult.success) {
        const createZones: Zone[] = [];

        for (const key of Object.keys(this.zoneNames)) {
          if (this.zoneNames[key] !== undefined && this.zoneNames[key] !== '') {
            createZones.push({
              index: Number(key),
              name: this.zoneNames[key],
            });
          }
        }

        this.log(createZones);

        return [
          {
            name: this.pairResult.model ?? 'Unknown model',
            data: {
              id: `rainbird_${this.pairData.host}`,
            },
            settings: {
              host: this.pairData.host,
              password: this.pairData.password,
              defaultIrrigationTime: this.pairData.defaultIrrigationTime,
              enableQueueing: this.pairData.enableQueueing,
              zones: createZones,
            },
          },
        ];
      }
      return [];
    });

    session.setHandler('showView', async (view) => {
      if (view === 'zones') {
        await session.emit('pairing_data', this.pairResult);
      }
    });
  }

}

module.exports = MyDriver;
