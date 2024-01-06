import Homey from 'homey';
import { PairSession } from 'homey/lib/Driver';
import { RainBirdService } from '../../RainBird/RainBirdService';
import { create } from 'axios';
import { Zone } from './zone';

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
    const service = new RainBirdService({
      address: data.host,
      password: data.password,
      log: this,
      syncTime: false,
      showRequestResponse: true,
      refreshRate: 0
    });

    const client = service.client;
    
    const model = await client.getModelAndVersion(false);
    const zones = await client.getAvailableZones(false);

    if (model === undefined || zones === undefined) {
      return {
        success: false
      }
    } else {
      return {
        success: true,
        zones: zones.zones,
        model: model.modelName,
      }
    }
  }

  async onPair(session: PairSession) {
    session.setHandler("form_complete", async (data) => {
      if (data.host && data.password) {
        this.pairData = data as PairData;

        this.pairResult = await this.connect(this.pairData as PairData);

        if (!this.pairResult.success) {
          return this.pairResult;
        } else {
          session.nextView();
          return this.pairResult;
        }
      } else {
        return {
          success: false,
        };
      }
    });

    session.setHandler('update_zone_names', async (data) => {
      this.zoneNames = data;
    })

    session.setHandler('list_devices', async () => {
      if (this.pairData && this.pairResult && this.pairResult.success) {

        const createZones: Zone[] = [];
        for (const key in this.zoneNames) {
          if (this.zoneNames[key] !== undefined && this.zoneNames[key] !== '') {
            createZones.push({
              index: Number(key),
              name: this.zoneNames[key]
            });
          }
        }

        this.log(createZones);

        return [
          {
            name: this.pairResult.model ?? 'Unknown model',
            data: {
              id: `rainbird_${this.pairData.host}`
            },
            settings: {
              host: this.pairData.host,
              password: this.pairData.password,
              defaultIrrigationTime: this.pairData.defaultIrrigationTime,
              enableQueueing: this.pairData.enableQueueing,
              zones: createZones,
            },
          }
        ]
      } else {
        return [];
      }
    });

    session.setHandler('showView', async (view) => {
      if (view === 'zones') {
        await session.emit('pairing_data', this.pairResult);
      }
    });
  } 

  /**
   * onPairListDevices is called when a user is adding a device and the 'list_devices' view is called.
   * This should return an array with the data of devices that are available for pairing.
   */
  async onPairListDevices() {
    /*
    const zones = 6;
    const model = 'ASDGFAS';
    const name = `Rainbird Controller (${zones} zones)`;
    return [
      {
        name: name,
        data: {
          id: '12839018',
          model: model,
        },
        settings: {
          host: '10.210.1.22',
          password: 'Pcx9HXmVmaG3',
          defaultIrrigationTime: 15,
          debug: true,
          enableQueueing: false,
          zones: [
            {
              index: 1,
              name: "Sproeiers",
            },
            {
              index: 2,
              name: "Druppelslang zijkant",
            },
            {
              index: 3,
              name: "Druppelslang achter"
            },
            {
              index: 4,
              name: "Kraan achtertuin"
            },
            {
              index: 6,
              name: "Ongebruikt maar toch ingevuld"
            }
          ]
        }
      }
    ]
    return [
      // Example device data, note that `store` is optional
      // {
      //   name: 'My Device',
      //   data: {
      //     id: 'my-device',
      //   },
      //   store: {
      //     address: '127.0.0.1',
      //   },
      // },
    ];*/
    return [];
  }

}

module.exports = MyDriver;
