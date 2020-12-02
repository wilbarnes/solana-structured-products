use solana_program::{
    account_info::{next_account_info, AccountInfo},
    entrypoint,
    entrypoint::ProgramResult,
    info,
    program::{invoke, invoke_signed},
    program_error::ProgramError,
    program_pack::Pack,
    pubkey::Pubkey,
    rent::Rent,
    system_instruction,
    sysvar::Sysvar,
};

use spl_associated_token_account::*;

entrypoint!(process_instruction);
fn process_instruction(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    instruction_data: &[u8],
) -> ProgramResult {
    info!(&format!(
        "process_instruction: {}: {} accounts, data={:?}",
        program_id,
        accounts.len(),
        instruction_data
    ));

    match instruction_data.get(0) {
        Some(0) => {
            info!("Create account...");
            let account_info_iter = &mut accounts.iter();
            let program_token_info = next_account_info(account_info_iter)?;
            let (program_token_address, program_token_bump_seed) =
                Pubkey::find_program_address(&[br"program-token"], program_id);

            if program_token_address != *program_token_info.key {
                info!("Error: program token address derivation mismatch");
                return Err(ProgramError::InvalidArgument);
            }

            let program_token_signer_seeds: &[&[_]] = &[
                br"program-token", &[program_token_bump_seed]
            ];

            // payer.pubkey()
            let funder_info = next_account_info(account_info_iter)?;
            // spl_token::native_mint::id()
            let mint_info = next_account_info(account_info_iter)?;
            // solana_program::system_program::id()
            let system_program_info = next_account_info(account_info_iter)?;
            // spl_token::id()
            let spl_token_program_info = next_account_info(account_info_iter)?;
            // sysvar::rent::id()
            let rent_sysvar_info = next_account_info(account_info_iter)?;

            let rent = &Rent::from_account_info(rent_sysvar_info)?;

            invoke_signed(
                &system_instruction::create_account(
                    funder_info.key,
                    program_token_info.key,
                    1.max(rent.minimum_balance(spl_token::state::Account::get_packed_len())),
                    spl_token::state::Account::get_packed_len() as u64,
                    &spl_token::id(),
                ),
                &[
                    funder_info.clone(),
                    program_token_info.clone(),
                    system_program_info.clone(),
                ],
                &[&program_token_signer_seeds],
            )?;

            info!("Initializing program token account");
            invoke(
                &spl_token::instruction::initialize_account(
                    &spl_token::id(),
                    program_token_info.key,
                    mint_info.key,
                    program_token_info.key, // token owner is also `program_token` address
                )?,
                &[
                    program_token_info.clone(),
                    spl_token_program_info.clone(),
                    rent_sysvar_info.clone(),
                    mint_info.clone(),
                ],
            )?;
            Ok(())
        }
        Some(1) => {
            info!("Close program token account...");

            let account_info_iter = &mut accounts.iter();
            let program_token_info = next_account_info(account_info_iter)?;
            let (program_token_address, program_token_bump_seed) =
                Pubkey::find_program_address(&[br"program-token"], program_id);

            if program_token_address != *program_token_info.key {
                info!("Error: program token address derivation mismatch");
                return Err(ProgramError::InvalidArgument);
            }

            let program_token_signer_seeds: &[&[_]] = &[
                br"program-token", &[program_token_bump_seed]
            ];

            let funder_info = next_account_info(account_info_iter)?;
            let spl_token_program_info = next_account_info(account_info_iter)?;

            invoke_signed(
                &spl_token::instruction::close_account(
                    &spl_token::id(),
                    program_token_info.key,
                    funder_info.key,
                    program_token_info.key, // token owner is also `program_token` address
                    &[],
                )
                .expect("close_account"),
                &[
                    funder_info.clone(),
                    spl_token_program_info.clone(),
                    program_token_info.clone(),
                ],
                &[&program_token_signer_seeds],
            )
        }
        Some(2) => {
            info!("Let's create one associated-program tokens addresses...");

            let account_info_iter = &mut accounts.iter();

            let wallet_address      = next_account_info(account_info_iter)?; // wallet address
            let ext_spl_token_mint  = next_account_info(account_info_iter)?; // external spl token mint
            let program_token_info  = next_account_info(account_info_iter)?; // associated account
            let system_program_info = next_account_info(account_info_iter)?;
            let mint_info           = next_account_info(account_info_iter)?;

            let (
                program_token_address,      // Pubkey, valid program address
                program_token_bump_seed     // u8, bump seed
            ) =
                Pubkey::find_program_address(
                    &[
                         &wallet_address.key.to_bytes(),
                         &spl_token::id().to_bytes(),
                         &ext_spl_token_mint.key.to_bytes(),
                    ], 
                    &spl_associated_token_account::id(),
                );
            
            if program_token_address != *program_token_info.key {
                info!("Error: program token asset 1 address derivation mismatch");
                return Err(ProgramError::InvalidArgument);
            }

            let program_token_signer_seeds: &[&[_]] = &[
                 &wallet_address.key.to_bytes(),
                 &spl_token::id().to_bytes(),
                 &ext_spl_token_mint.key.to_bytes(),
                 &spl_associated_token_account::id().to_bytes(),
                 &[program_token_bump_seed],
            ];

            let funder_info = next_account_info(account_info_iter)?;
            let spl_token_program_info = next_account_info(account_info_iter)?;

            let rent_sysvar_info = next_account_info(account_info_iter)?;
            let rent = &Rent::from_account_info(rent_sysvar_info)?;

            // invoke_signed(
            //     &system_instruction::create_account(
            //         funder_info.key,
            //         program_token_info.key,
            //         1.max(rent.minimum_balance(spl_token::state::Account::get_packed_len())),
            //         spl_token::state::Account::get_packed_len() as u64,
            //         &spl_token::id(),
            //     ),
            //     &[
            //         funder_info.clone(),
            //         program_token_info.clone(),
            //         system_program_info.clone(),
            //     ],
            //     &[&program_token_signer_seeds],
            // )?;

            // info!("Initializing program token account 1");
            // invoke(
            //     &spl_token::instruction::initialize_account(
            //         &spl_token::id(),
            //         // &program_token_address,
            //         program_token_info.key,
            //         mint_info.key,
            //         program_token_info.key,
            //         // &program_token_address, // token owner is also `program_token` address
            //     )?,
            //     &[
            //         program_token_info.clone(),
            //         // program_token_address.clone(),
            //         spl_token_program_info.clone(),
            //         rent_sysvar_info.clone(),
            //         mint_info.clone(),
            //     ],
            // )?;
            Ok(())
        }
        _ => {
            info!("Error: Unsupported instruction");
            Err(ProgramError::InvalidInstructionData)
        }
    }
}

#[cfg(test)]
mod test {
    #![cfg(feature = "test-bpf")]

    use super::*;
    use assert_matches::*;
    use solana_program::{
        instruction::{AccountMeta, Instruction},
        sysvar,
    };
    use solana_program_test::*;
    use solana_sdk::{signature::Signer, transaction::Transaction};

    fn program_test(program_id: Pubkey, spl_one: Pubkey, spl_two: Pubkey) -> ProgramTest {
        let mut pc = ProgramTest::new(
            "bpf_program_template",
            program_id,
            processor!(process_instruction),
        );

        // Add SPL Token program
        pc.add_program(
            "spl_token",
            spl_token::id(),
            processor!(spl_token::processor::Processor::process),
        );

        // Add SPL Token program
        pc.add_program(
            "spl_token2",
            spl_two,
            processor!(spl_token::processor::Processor::process),
        );

        pc
    }

    #[tokio::test]
    async fn test_create_then_close() {
        let program_id  = Pubkey::new_unique();
        
        let spl_one = Pubkey::new_unique();
        let spl_two = Pubkey::new_unique();

        let (mut banks_client, payer, recent_blockhash) = program_test(
            program_id,
            spl_one,
            spl_two
        ).start().await;

        let program_token_address =
            Pubkey::find_program_address(&[br"program-token"], &program_id).0;

        // Create the program-owned token account
        let mut transaction = Transaction::new_with_payer(
            &[Instruction {
                program_id,
                accounts: vec![
                    AccountMeta::new(program_token_address, false),
                    // program_token_address uses the base program's programId
                    AccountMeta::new(program_token_address, false),
                    // payer (funder)
                    AccountMeta::new(payer.pubkey(), true),
                    // native mint for SOL wrapping ???
                    AccountMeta::new_readonly(spl_token::native_mint::id(), false),
                    AccountMeta::new_readonly(solana_program::system_program::id(), false),
                    AccountMeta::new_readonly(spl_token::id(), false),
                    AccountMeta::new_readonly(sysvar::rent::id(), false),
                ],
                data: vec![0],
            }],
            Some(&payer.pubkey()),
        );
        transaction.sign(&[&payer], recent_blockhash);
        assert_matches!(banks_client.process_transaction(transaction).await, Ok(()));

        // Fetch the program-owned token account and confirm it now exists
        let program_token_account = banks_client
            .get_account(program_token_address)
            .await
            .expect("success")
            .expect("some account");

        let program_token_account =
            spl_token::state::Account::unpack_from_slice(&program_token_account.data)
                .expect("unpack success");
        assert_eq!(program_token_account.mint, spl_token::native_mint::id());
        assert_eq!(program_token_account.owner, program_token_address);

        // Close the the program-owned token account
        let mut transaction = Transaction::new_with_payer(
            &[Instruction {
                program_id,
                accounts: vec![
                    AccountMeta::new(program_token_address, false),
                    AccountMeta::new(payer.pubkey(), true),
                    AccountMeta::new_readonly(spl_token::id(), false),
                ],
                data: vec![1],
            }],
            Some(&payer.pubkey()),
        );
        transaction.sign(&[&payer], recent_blockhash);
        assert_matches!(banks_client.process_transaction(transaction).await, Ok(()));

        // Fetch the program-owned token account and confirm it no longer now exists
        assert_eq!(
            banks_client
                .get_account(program_token_address)
                .await
                .expect("success"),
            None
        );
    }
}
