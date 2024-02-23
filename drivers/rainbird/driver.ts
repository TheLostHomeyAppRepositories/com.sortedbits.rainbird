import Homey from 'homey';
import { PairSession } from 'homey/lib/Driver';

import { Zone } from './models/zone';
import { FormResult } from './models/form-result';

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

class RainBirdDriver extends Homey.Driver {

  pairData: PairData | undefined;
  pairResult: PairResult | undefined;
  zoneNames: Record<number, string> = {};

  /**
   * onInit is called when the driver is initialized.
   */
  onInit = async () => {
    this.log('Rainbird has been initialized');
  }

  connect = async (data: PairData): Promise<PairResult> => {
    // eslint-disable-next-line node/no-unsupported-features/es-syntax
    const serviceType = await import('rainbird/dist/RainBird/RainBirdService.js');
    const { RainBirdService } = serviceType;

    const service = new RainBirdService({
      address: data.host,
      password: data.password,
      syncTime: false,
      showRequestResponse: true,
      refreshRate: 0,
    });

    const metadata = await service.init();

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

  createZonesFromData = (data: Record<number, string>): Zone[] => {
    const result: Zone[] = [];
    for (const key of Object.keys(data)) {
      if (this.zoneNames[key] !== undefined && this.zoneNames[key] !== '') {
        result.push({
          index: Number(key),
          name: this.zoneNames[key],
        });
      }
    }
    return result;
  };

  onPair = async (session: PairSession) => {
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
        const zones = this.createZonesFromData(this.zoneNames);

        this.log('pairData', JSON.stringify(this.pairData));

        return [
          {
            name: this.pairResult.model ?? 'Unknown model',
            data: {
              id: `rainbird_${this.pairData.host}`,
            },
            settings: {
              host: this.pairData.host,
              password: this.pairData.password,
              defaultIrrigationTime: Number(this.pairData.defaultIrrigationTime),
              enableQueueing: this.pairData.enableQueueing,
              zones,
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

  onRepair = async (session: PairSession, device: Homey.Device) => {
    session.setHandler('showView', async (view) => {
      if (view === 'zone_names') {
        await this.emitZoneMetadata(session, device);
      }
    });

    session.setHandler('zone_name_update', async (data) => {
      return this.zoneNameUpdate(data, device);
    });
  }

  emitZoneMetadata = async (session: PairSession, device: Homey.Device) => {
    const { zones, zonesAvailable } = await device.getSettings();
    await session.emit('metadata', {
      zones,
      zonesAvailable,
    });
  };

  zoneNameUpdate = async (data: Record<number, string>, device: Homey.Device): Promise<FormResult> => {
    this.zoneNames = data;

    try {
      const zones = this.createZonesFromData(this.zoneNames);

      await device.setSettings({
        zones,
      });

      return {
        success: true,
      };
    } catch (error) {
      return {
        success: false,
      };
    }
  }

  testMethod = (): string => {
    return 'test';
  }

}

module.exports = RainBirdDriver;
