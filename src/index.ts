import {
    Connection,
    Keypair,
    PublicKey,
    SystemProgram,
    Transaction,
    LAMPORTS_PER_SOL,
    clusterApiUrl,
    TransactionInstruction,
} from '@solana/web3.js';
import bs58 from 'bs58';
import dotenv from 'dotenv';
dotenv.config(); 

const connection = new Connection(clusterApiUrl('devnet'), 'confirmed');

const senderSecretKey = process.env.SENDER_SECRET_KEY;

if (!senderSecretKey) {
  throw new Error('Missing required environment variable: SENDER_SECRET_KEY');
}

const payer = Keypair.fromSecretKey(bs58.decode(senderSecretKey));

console.log('Payer public key:', payer.publicKey.toBase58());

const TRANSFER_INSTRUCTION_INDEX = 2;

function manualTransferInstruction(
    from: PublicKey,
    to: PublicKey,
    lamports: number | bigint,
): TransactionInstruction {
    const data = Buffer.alloc(4 + 8);

    data.writeUInt32LE(TRANSFER_INSTRUCTION_INDEX, 0);

    (data as any).writeBigUInt64LE(BigInt(lamports), 4);

    return new TransactionInstruction({
        programId: SystemProgram.programId,
        keys: [
            {
                pubkey: from,
                isSigner: true,
                isWritable: true,
            },
            {
                pubkey: to,
                isSigner: false,
                isWritable: true,
            },
        ],
        data,
    });
}

const CREATE_ACCOUNT_INDEX = 0;

function createAccountInstruction(
    fromPubkey: PublicKey,
    newAccountPubkey: PublicKey,
    lamports: number | bigint,
    space: number | bigint,
    owner: PublicKey,
): TransactionInstruction {
    const buffer = Buffer.alloc(4 + 8 + 8 + 32);

    buffer.writeUInt32LE(CREATE_ACCOUNT_INDEX, 0);

    (buffer as any).writeBigUInt64LE(BigInt(lamports), 4);

    (buffer as any).writeBigUInt64LE(BigInt(space), 12);

    owner.toBuffer().copy(buffer, 20);

    return new TransactionInstruction({
        programId: SystemProgram.programId,
        keys: [
            {
                pubkey: fromPubkey,
                isSigner: true,
                isWritable: true,
            },
            {
                pubkey: newAccountPubkey,
                isSigner: true,
                isWritable: true,
            },
        ],
        data: buffer,
    });
}

const transaction = new Transaction();

const newAccount = Keypair.generate();
console.log('New account public key:', newAccount.publicKey.toBase58());

const createIx = createAccountInstruction(
    payer.publicKey,
    newAccount.publicKey,
    0.2 * LAMPORTS_PER_SOL,
    0n,
    SystemProgram.programId
);

const transferIx = manualTransferInstruction(
    payer.publicKey,
    newAccount.publicKey,
    0.1 * LAMPORTS_PER_SOL,
);

transaction.add(
    createIx,
    transferIx,
);

const lastestBlockhash = await connection.getLatestBlockhash('confirmed');
console.log('Recent blockhah:', lastestBlockhash.blockhash);

transaction.recentBlockhash = lastestBlockhash.blockhash;
transaction.feePayer = payer.publicKey;

transaction.sign(payer, newAccount);

const rawTransaction = transaction.serialize();

try {
    const txSignature  = await connection.sendRawTransaction(rawTransaction, {
        skipPreflight: false,
    });
    console.log('Submitted transaction signature:', txSignature);

    const confirmation = await connection.confirmTransaction(
    {
        signature: txSignature,
        blockhash: lastestBlockhash.blockhash,
        lastValidBlockHeight: lastestBlockhash.lastValidBlockHeight,
    },
    'confirmed'
    );

    console.log('Confirmation:', confirmation);
    console.log(
        `View on explorer: https://explorer.solana.com/tx/${txSignature}?cluster=devnet`
    );
    console.log('New account funded at:', newAccount.publicKey.toBase58());
} catch (e: any) {
    console.error('SendTransactionError:', e);
    if (e.getLogs) {
        console.log('Logs:', await e.getLogs(connection));
    } else if (e.transactionLogs) {
        console.log('Logs:', e.transactionLogs);
    }
}
