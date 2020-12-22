import {
    establishConnection,
    establishPayer,
    loadProgram,
    createTokensAndAddresses,
    depositAssets,
} from './tranches';

async function main() {
    console.log("Creating accounts, tokens, and simulating derivative product...");

    await establishConnection();
    await establishPayer();
    await loadProgram();
    await createTokensAndAddresses();
    await depositAssets();
    
    console.log('Success');
}

main().then(
    () => process.exit(),
    err => {
        console.error(err);
        process.exit(-1);
    },
);
