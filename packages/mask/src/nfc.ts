import NfcManager, { NfcTech, Ndef } from 'react-native-nfc-manager';

interface NfcPairData {
    proto: 'vailix';
    v: 1;
    rpi: string;
    metadataKey: string;
    ts: number;
}

export class NfcService {
    private initialized = false;

    async initialize(): Promise<boolean> {
        try {
            const supported = await NfcManager.isSupported();
            if (supported) {
                await NfcManager.start();
                this.initialized = true;
            }
            return supported;
        } catch {
            return false;
        }
    }

    static async isSupported(): Promise<boolean> {
        return NfcManager.isSupported();
    }

    async pair(myRpi: string, myMetadataKey: string): Promise<{ success: boolean; partnerRpi?: string; partnerMetadataKey?: string }> {
        if (!this.initialized) {
            throw new Error('NFC not initialized');
        }

        try {
            // Request NFC technology
            await NfcManager.requestTechnology(NfcTech.Ndef);

            // Prepare our data
            const myData: NfcPairData = {
                proto: 'vailix',
                v: 1,
                rpi: myRpi,
                metadataKey: myMetadataKey,
                ts: Date.now(),
            };

            // Write our data for partner to read
            const bytes = Ndef.encodeMessage([
                Ndef.textRecord(JSON.stringify(myData)),
            ]);
            await NfcManager.ndefHandler.writeNdefMessage(bytes);

            // Read partner's data
            const tag = await NfcManager.getTag();
            if (!tag?.ndefMessage?.[0]) {
                return { success: false };
            }

            const payload = Ndef.text.decodePayload(tag.ndefMessage[0].payload as any);
            const partnerData: NfcPairData = JSON.parse(payload);

            if (partnerData.proto !== 'vailix' || partnerData.v !== 1) {
                return { success: false };
            }

            return {
                success: true,
                partnerRpi: partnerData.rpi,
                partnerMetadataKey: partnerData.metadataKey,
            };
        } catch (error) {
            return { success: false };
        } finally {
            NfcManager.cancelTechnologyRequest();
        }
    }

    cleanup(): void {
        if (this.initialized) {
            NfcManager.cancelTechnologyRequest();
        }
    }
}
