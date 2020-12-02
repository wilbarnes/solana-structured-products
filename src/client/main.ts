import {
    establishConnection,
    establishPayer,
    createPairOfTokens,
    loadProgram,
    createAddresses,
} from './tranches';

async function main() {
    console.log("Let's create two SPL Tokens...");

    await establishConnection();
    await establishPayer();
    await createPairOfTokens();
    await loadProgram();
    await createAddresses();
    
    console.log('Success');
}

main().then(
    () => process.exit(),
    err => {
        console.error(err);
        process.exit(-1);
    },
);
