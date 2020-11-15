import {
    establishConnection,
    establishPayer,
    createPairOfTokens,
} from './tranches';

async function main() {
    console.log("Let's create two SPL Tokens...");

    await establishConnection();
    await establishPayer();
    await createPairOfTokens();
    
    console.log('Success');
}

main().then(
    () => process.exit(),
    err => {
        console.error(err);
        process.exit(-1);
    },
);
