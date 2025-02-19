import { Attribute, BaseAttributeWithState, Device, NumberAttribute, Provider, SelectAttribute } from 'quantumhub-sdk';
import { createCommunicator, Communicator, Evse } from 'sorted-emproto';
import { ChargingStatus } from './chargin-status';

export class BesenWallbox implements Device {
    private provider!: Provider;
    private communicator!: Communicator;
    private evse?: Evse;

    private _updateAmpsTimeout: NodeJS.Timeout | undefined;

    init = async (provider: Provider): Promise<boolean> => {
        this.provider = provider;

        this.communicator = createCommunicator();

        return true;
    }

    start = async (): Promise<void> => {
        await this.provider.setAvailability(true);

        const { serial, password } = this.provider.getConfig();

        const clientPort = await this.communicator.start();
        await this.updateAttributeWithState('client_port', clientPort);
        this.provider.logger.trace(`Started listening on port ${clientPort}`);

        this.communicator.addEventListener(["added", "changed", "removed"], async (evse, event) => {
            if (evse.info.serial !== serial.toString()) {
                this.provider.logger.warn(`Found an EVSE with a different serial: '${evse.info.serial}'`);
            }

            if (event === 'added') {
                this.provider.logger.info(`Found EVSE with serial ${serial}, logging in ${password}`);
                this.evse = evse;
                this.evse.onError = this.onEvseError;
                this.evse.login(password.toString());
            } else if (event === 'changed') {
                this.provider.logger.info('EVSE changed');

                await this.updateEvse(evse);
            }

        })
    }

    stop = async (): Promise<void> => {
        this.communicator.stop();
    }

    destroy = async (): Promise<void> => {
    }

    valueChanged = async (attribute: Attribute, value: any): Promise<void> => {
        this.provider.logger.info(`Setting ${attribute.name} to ${value}`);
    }

    onNumberChanged = async (attribute: Attribute, value: number): Promise<void> => {
        this.provider.logger.info(`Setting number ${attribute.name} to ${value}`);

        if (this.evse && attribute.key === 'max_output_electricity') {
            if (this._updateAmpsTimeout) {
                clearTimeout(this._updateAmpsTimeout);
            }

            this._updateAmpsTimeout = setTimeout(() => {
                if (value >= 6 && value <= 16) {
                    this.evse?.setMaxElectricity(value);
                }
            }, 1500);
        }
    }

    private updateAttributeWithState = async (name: string, value?: any, updateUndefined = false) => {
        if (value === undefined && !updateUndefined) {
            return;
        }

        const attribute = await this.provider.getAttribute<BaseAttributeWithState>(name);

        if (attribute) {
            await this.provider.setAttributeState(attribute, { state: value });
        }
    }

    private onEvseError = (command?: number) => {
        this.provider.logger.error(`Error happened while performing command: ${command}`);
    }

    private updateEvse = async (evse: Evse) => {
        this.updateAttributeWithState('brand', evse.info.brand);
        this.updateAttributeWithState('model', evse.info.model);
        this.updateAttributeWithState('phases', evse.info.phases);
        this.updateAttributeWithState('max_power', evse.info.maxPower);
        this.updateAttributeWithState('max_electricity', evse.info.maxElectricity);

        this.updateAttributeWithState('current_power', evse.state?.currentPower);
        this.updateAttributeWithState('current_amount', evse.state?.currentAmount);
        this.updateAttributeWithState('l1_voltage', evse.state?.l1Voltage);
        this.updateAttributeWithState('l2_voltage', evse.state?.l2Voltage);
        this.updateAttributeWithState('l3_voltage', evse.state?.l3Voltage);
        this.updateAttributeWithState('l1_electricity', evse.state?.l1Electricity);
        this.updateAttributeWithState('l2_electricity', evse.state?.l2Electricity);
        this.updateAttributeWithState('l3_electricity', evse.state?.l3Electricity);

        this.updateAttributeWithState('gun_state', evse.state?.gunState);
        this.updateAttributeWithState('output_state', evse.state?.outputState);
        this.updateAttributeWithState('current_state', evse.state?.currentState);

        this.updateAttributeWithState('max_output_electricity', evse.config.maxElectricity);

        if (evse.state?.gunState !== undefined && evse.state?.currentState !== undefined) {
            this.updateAttributeWithState('charging_state', this.statesToChargingStatus(evse.state.gunState, evse.state.currentState));
        }
    }

    private statesToChargingStatus = (gunState: number, currentState: number): ChargingStatus => {
        if (gunState === undefined || currentState === undefined) {
            return ChargingStatus.Unknown;
        }

        switch (currentState) {
            case 1:
                return ChargingStatus.Fault;
            case 2:
            case 3:
                return ChargingStatus.Fault; // No idea?
            case 10:
                // "Wait for the swipe to start" ??
                return ChargingStatus.Waiting;
            case 11:
                return ChargingStatus.Charging;
            case 12:
                return ChargingStatus.NotConnected;
            case 13:
                return ChargingStatus.Connected;
            case 14:
                if (gunState === 4) {
                    return ChargingStatus.Charging;
                }
                if (gunState === 2) {
                    return ChargingStatus.ChargingStarted;
                }

                return ChargingStatus.Unknown;
            case 15:
                if (gunState === 4 || gunState === 2) {
                    return ChargingStatus.Finished;
                }
            case 17:
                return ChargingStatus.FullyCharged;
            case 20:
                return ChargingStatus.ChargingReservation;
            default:
                return ChargingStatus.Unknown;
        }
    }
}

export default BesenWallbox;
