import {
    Connection,       // RPC ke through cluster se baat karne ke liye.
    Keypair,          // private/public key pair; yahi signer hota hai.
    PublicKey,        // public address (base58 string se PublicKey object).
    SystemProgram,    // built‑in program jo SOL transfer, account create, etc karta hai.
    Transaction,      // jo actual transaction container hai.
    LAMPORTS_PER_SOL, //  SOL → lamports conversion constant.
    clusterApiUrl,    // cluster ke RPC URL ko get karne ke liye.
    TransactionInstruction, // Manually instruction create karne ke liye.
} from '@solana/web3.js';
import bs58 from 'bs58'; // Base58 encoding/decoding ke liye.
import dotenv from 'dotenv';
dotenv.config(); 

/* 
1. Devnet pe connect 

Under the hood: Connection WebSocket + HTTP RPC clients internally create karta hai, jo getRecentBlockhash, sendRawTransaction, etc expose karte hain.

*/
const connection = new Connection(clusterApiUrl('devnet'), 'confirmed');

const senderSecretKey = process.env.SENDER_SECRET_KEY;

if (!senderSecretKey) {
  throw new Error('Missing required environment variable: SENDER_SECRET_KEY');
}

const payer = Keypair.fromSecretKey(bs58.decode(senderSecretKey));

console.log('Payer public key:', payer.publicKey.toBase58());

// =============================
// 2. Manual SystemProgram.transfer (payer -> newAccount later)
// =============================

// 2.1: Instruction index (discriminant) define karo.
// System Program ke liye standard enum hota hai:
// 0: CreateAccount
// 1: Assign
// 2: Transfer
// 8: Allocate
// etc...
const TRANSFER_INSTRUCTION_INDEX = 2;

// Helper: manual transfer instruction banane ka function.
// Yahan hum generic rakh rahe hain taake from/to dono parametrized hon.
function manualTransferInstruction(
    from: PublicKey,
    to: PublicKey,
    lamports: number | bigint,
): TransactionInstruction {
    // Layout: [u32: instruction_index][u64: lamports]
    const data = Buffer.alloc(4 + 8);

    // u32 LE: instruction index = 2 (Transfer)
    data.writeUInt32LE(TRANSFER_INSTRUCTION_INDEX, 0);

    // u64 LE: lamports
    (data as any).writeBigUInt64LE(BigInt(lamports), 4);

    return new TransactionInstruction({
        programId: SystemProgram.programId, // 11111111111111111111111111111111
        keys: [
            {
                pubkey: from,
                isSigner: true,   // fromPubkey ko sign karna zaroori hai kyunki uska balance debit hoga
                isWritable: true, // SOL balance change hoga
            },
            {
                pubkey: to,
                isSigner: false,  // recipient ko sign karne ki zaroorat nahi
                isWritable: true, // uska balance bhi update hoga
            },
        ],
        data, // [u32 instruction_index][u64 lamports]
    });
}

// =============================
// EXTRA: CreateAccount manually
// =============================

/*
   1) CreateAccount (index = 0)

   Layout (data):
   [u32: CreateAccount(0)]
   [u64: lamports]          // naye account ko kitne lamports dene hain
   [u64: space]             // account data ke bytes ka size
   [32 bytes: owner pubkey] // jis program ka yeh account owned hoga

   Keys:
   - [0] from (payer/ funder): signer + writable
   - [1] newAccount: signer + writable
*/
const CREATE_ACCOUNT_INDEX = 0;

function createAccountInstruction(
    fromPubkey: PublicKey,
    newAccountPubkey: PublicKey,
    lamports: number | bigint,
    space: number | bigint,
    owner: PublicKey,
): TransactionInstruction {
    // Data buffer length:
    // 4 (u32 index) + 8 (u64 lamports) + 8 (u64 space) + 32 (Pubkey)
    const buffer = Buffer.alloc(4 + 8 + 8 + 32);

    // Instruction index
    buffer.writeUInt32LE(CREATE_ACCOUNT_INDEX, 0);

    // lamports (u64 LE)
    (buffer as any).writeBigUInt64LE(BigInt(lamports), 4);

    // space (u64 LE)
    (buffer as any).writeBigUInt64LE(BigInt(space), 12);

    // owner pubkey (32 bytes)
    owner.toBuffer().copy(buffer, 20);

    return new TransactionInstruction({
        programId: SystemProgram.programId,
        keys: [
            {
                pubkey: fromPubkey,
                isSigner: true,  // funder must sign
                isWritable: true,
            },
            {
                pubkey: newAccountPubkey,
                isSigner: true,  // new account keypair must sign
                isWritable: true,
            },
        ],
        data: buffer,
    });
}

// (Assign / Allocate helpers yahan bhi add kiye ja sakte hain agar chaho,
// lekin abhi hum unko use nahi kar rahe, is liye skip kar rahe hain taake flow clean rahe.)

// =============================
// 3. Transaction Object
// =============================

/*
Under the hood: Transaction ek container hai jo multiple TransactionInstruction objects hold kar sakta hai.
*/

const transaction = new Transaction();

// Naya account generate karo jisko hum CreateAccount + Transfer se fund karenge
const newAccount = Keypair.generate();
console.log('New account public key:', newAccount.publicKey.toBase58());

// 3.1 CreateAccount: payer -> newAccount
// Yahan hum ek simple "system account" bana rahe hain jiska koi data nahi (space = 0).
const createIx = createAccountInstruction(
    payer.publicKey,
    newAccount.publicKey,
    0.2 * LAMPORTS_PER_SOL, // lamports for new account
    0n,                     // space = 0 for plain SOL account (no custom data)
    SystemProgram.programId // owner: SystemProgram (normal system-owned account)
);

// 3.2 Transfer: payer -> newAccount (manual transfer)
// Ab hum ek alag transfer instruction bana rahe hain jo newly created account ko aur 0.1 SOL bhejega.
const transferIx = manualTransferInstruction(
    payer.publicKey,
    newAccount.publicKey,
    0.1 * LAMPORTS_PER_SOL,
);

// Same transaction mein instructions add karo:
transaction.add(
    createIx,    // index = 0 (CreateAccount)
    transferIx,  // index = 2 (Transfer)
);

// NOTE: Yahan execution order wahi hoga jo add(...) ka order hai.

/*
Is point pe:

transaction.instructions: [createIx, transferIx]
transaction.recentBlockhash: abhi set nahi
transaction.feePayer: abhi set nahi
transaction.signatures: empty
*/

// 3.3 Recent blockhash set karna zaroori hai taaki transaction valid ho.
const lastestBlockhash = await connection.getLatestBlockhash('confirmed');
console.log('Recent blockhah:', lastestBlockhash.blockhash);

// 3.4 Transaction ke fields set karo
transaction.recentBlockhash = lastestBlockhash.blockhash;
transaction.feePayer = payer.publicKey;

/*

Ab:

feePayer → payer
recentBlockhash → latestBlockhash.blockhash
instructions: [createIx, transferIx]
signatures: abhi empty
*/

// 4. Sign Transaction
transaction.sign(payer, newAccount);

/*
payer: funder / fee payer
newAccount: kyunki CreateAccount mein new account ko bhi signer hona parta hai

Under the hood:

1. Transaction ko “message” mein convert karti hai:

    compileMessage():
        Unique account list banata hai.
        Header (numRequiredSignatures, numReadonlySignedAccounts, etc).
        Recent blockhash add karta hai.
        Instructions ko account indices + data ke sath encode karta hai.
    Ye sab milke ek Message banta hai (binary form).

2. Message ko serialize karta hai (message.serialize()).   

3. Har signer ke liye:

    ed25519 signature: sign(sha256(messageBytes)).
    Signature ek 64‑byte array hoti hai.

4. transaction.signatures array mein har signer ka { publicKey, signature } store karta hai.

*/

// 5. Raw serialize + send

const rawTransaction = transaction.serialize(); // Buffer of full tx data: Yeh buffer Network ko bheja jata hai via sendRawTransaction.

try {
    const txSignature  = await connection.sendRawTransaction(rawTransaction, {
        skipPreflight: false, // By default preflight simulation run hoti hai
    });
    console.log('Submitted transaction signature:', txSignature);

    // 6. Confirm Transaction
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
    // Error details (logs etc.)
    console.error('SendTransactionError:', e);
    if (e.getLogs) {
        console.log('Logs:', await e.getLogs(connection));
    } else if (e.transactionLogs) {
        console.log('Logs:', e.transactionLogs);
    }
}