// Copyright (c) 2024 The Bitcoin developers
// Distributed under the MIT software license, see the accompanying
// file COPYING or http://www.opensource.org/licenses/mit-license.php.

import * as http from 'http';
import request from 'supertest';
import config from '../config';
import { encodeCashAddress, getOutputScriptFromAddress } from 'ecashaddrjs';
import { startExpressServer } from '../src/routes';
import { MockChronikClient } from '../../../modules/mock-chronik-client';
import TelegramBot from 'node-telegram-bot-api';
import { createFsFromVolume, vol, IFs, DirectoryJSON } from 'memfs';
import sharp from 'sharp';
import secrets from '../secrets';
import {
    MOCK_SCRIPT_UTXO,
    MOCK_SPENDABLE_TOKEN_UTXO,
    MOCK_OUTPOINT,
    MOCK_UTXO_TOKEN,
} from '../test/vectors';
import { Ecc } from 'ecash-lib';
import { rateLimit } from 'express-rate-limit';
import { MongoClient, Db } from 'mongodb';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { initializeDb, initialBlacklist } from '../src/db';
import axios from 'axios';
import MockAdapter from 'axios-mock-adapter';
import { ChronikClient, ScriptUtxo, Tx } from 'chronik-client';

// Clone initialBlacklist before initializing the database
// initializeDb(initialBlacklist) will modify the entries by adding an "_id" key
const mockBlacklist = initialBlacklist.map(entry => ({ ...entry }));

describe('routes.js', async function () {
    // Initialize Ecc
    const ecc = new Ecc();
    let mongoServer: MongoMemoryServer, testMongoClient: MongoClient;
    before(async () => {
        // Start mongo memory server before running this suite of unit tests
        mongoServer = await MongoMemoryServer.create();
        const mongoUri = mongoServer.getUri();
        testMongoClient = new MongoClient(mongoUri);
    });

    after(async () => {
        // Shut down mongo memory server after running this suite of unit tests
        await testMongoClient.close();
        await mongoServer.stop();
    });

    let app: http.Server;
    let badDbApp: http.Server;
    const SERVER_WALLET_ADDRESS = secrets.prod.wallet.address;
    const SERVER_WALLET_OUTPUTSCRIPT = getOutputScriptFromAddress(
        SERVER_WALLET_ADDRESS,
    );
    const ELIGIBLE_ADDRESS = 'ecash:qphlhe78677sz227k83hrh542qeehh8el5lcjwk72y';
    const ELIGIBLE_OUTPUTSCRIPT = getOutputScriptFromAddress(ELIGIBLE_ADDRESS);
    const INELIGIBLE_ADDRESS =
        'ecash:qp89xgjhcqdnzzemts0aj378nfe2mhu9yvxj9nhgg6';
    const INELIGIBLE_OUTPUTSCRIPT =
        getOutputScriptFromAddress(INELIGIBLE_ADDRESS);
    const INVALID_ADDRESS = 'ecash:erroraddress';
    const ERROR_ADDRESS = encodeCashAddress(
        'ecash',
        'p2pkh',
        '0000000000000000000000000000000000000000',
    );
    const mockedChronikClient = new MockChronikClient();
    // Set an eligible mock
    // Seen ~ 2x before the amount of time required
    const eligibleTimeFirstSeen =
        Math.ceil(Date.now() / 1000) - 2 * config.eligibilityResetSeconds;
    mockedChronikClient.setTxHistoryByAddress(ELIGIBLE_ADDRESS, [
        {
            timeFirstSeen: eligibleTimeFirstSeen,
            inputs: [{ outputScript: SERVER_WALLET_OUTPUTSCRIPT }],
            outputs: [
                {
                    outputScript: ELIGIBLE_OUTPUTSCRIPT,
                    token: { tokenId: config.rewardsTokenId },
                },
            ],
        } as Tx,
    ]);

    mockedChronikClient.setUtxosByAddress(SERVER_WALLET_ADDRESS, [
        { ...MOCK_SCRIPT_UTXO, value: 10000 },
        {
            ...MOCK_SPENDABLE_TOKEN_UTXO,
            outpoint: { ...MOCK_OUTPOINT, outIdx: 1 },
            token: {
                ...MOCK_UTXO_TOKEN,
                tokenId: config.rewardsTokenId,
                // Note, can change this to '10' or something less than config.rewardAmountTokenSats
                // to test behavior of server if it is out of tokens
                // Bad ROI on adding this test outright as we need lots of scripting
                // to overcome the need for multiple mocked server wallets
                amount: config.rewardAmountTokenSats,
            },
        },
    ] as ScriptUtxo[]);
    mockedChronikClient.setBroadcastTx(
        '02000000021111111111111111111111111111111111111111111111111111111111111111010000006441aa58606dc2133b1547da04323797794c8ae8a245518c82b6a360db52f9451b33b301eeb18c5851fd98989a7c24b384bfb49c18e37d1ffdf4e6bc42c30575913041210228363bacbd9e52c1e515e715633fd2376d58671cda418e05685447a4a49b0645ffffffff111111111111111111111111111111111111111111111111111111111111111100000000644168bf907b93ffc6f1dad8378ca5de1a35e4b3d3fae7f151fed92eabffa301ba01dce9d79108e4a4374414f5ac7364d99ef5ff506ef5a69cc58e91e4871e4f27f541210228363bacbd9e52c1e515e715633fd2376d58671cda418e05685447a4a49b0645ffffffff030000000000000000376a04534c500001010453454e4420aed861a31b96934b88c0252ede135cb9700d7649f69191235087a3030e553cb108000000000000271022020000000000001976a9146ffbe7c7d7bd01295eb1e371de9550339bdcf9fd88ac68250000000000001976a91476fb100532b1fe23b26930e7001dff7989d2db5588ac00000000',
        '1b3cb86a06c64afdbad89ac3660ee724cbb8a5a1b099763b993d63b1285bb404',
    );
    // Set an ineligible mock
    // Seen just now
    const ineligibleTimeFirstSeen = Math.ceil(Date.now() / 1000);
    mockedChronikClient.setTxHistoryByAddress(INELIGIBLE_ADDRESS, [
        {
            timeFirstSeen: ineligibleTimeFirstSeen,
            inputs: [{ outputScript: SERVER_WALLET_OUTPUTSCRIPT }],
            outputs: [
                {
                    outputScript: INELIGIBLE_OUTPUTSCRIPT,
                    token: { tokenId: config.rewardsTokenId },
                },
            ],
        } as Tx,
    ]);
    // Mock chronik throwing an error
    mockedChronikClient.setTxHistoryByAddress(
        ERROR_ADDRESS,
        new Error('some chronik error'),
    );

    // Address with no tx history
    // i.e. eligible for an XEC airdrop
    const NEW_ADDRESS = 'ecash:qrfkcnzdm0dvkrc20dhcf7qv23vt736ynuujzxnzs6';
    mockedChronikClient.setTxHistoryByAddress(NEW_ADDRESS, []);

    // Address with tx history
    // i.e. not eligible for an XEC airdrop
    const USED_ADDRESS = 'ecash:qrplfw9x5hrdnra3t42s3543gh3vtg8xgyr4t4lrun';
    mockedChronikClient.setTxHistoryByAddress(USED_ADDRESS, [
        { isTx: true },
    ] as unknown as Tx[]);

    // Mock an XEC airdrop tx
    const expectedXecAirdropTxid =
        'd19c496e82bd160c841968ec0d2b61bf64cb884b002835649594cd973967d33b';
    mockedChronikClient.setBroadcastTx(
        '02000000011111111111111111111111111111111111111111111111111111111111111111000000006441d51a04ca0cba7e791ceb0d39f19b45162756087e7058cf5dec770cbcabbc89598b5b6f966a3609b01a34b1e5b6853c46f843bd8b3507c0dbd6acc4329182b88841210228363bacbd9e52c1e515e715633fd2376d58671cda418e05685447a4a49b0645ffffffff0268100000000000001976a914d36c4c4ddbdacb0f0a7b6f84f80c5458bf47449f88accd150000000000001976a91476fb100532b1fe23b26930e7001dff7989d2db5588ac00000000',
        expectedXecAirdropTxid,
    );

    // Mock a stub telegram bot
    const mockedTgBot = { sendPhoto: () => {} };

    // Initialize fs, to be memfs in these tests
    let fs: IFs;
    let testDb: Db;
    beforeEach(async () => {
        testDb = await initializeDb(testMongoClient, initialBlacklist);
        // Mock expected file structure for fs
        const fileStructureJson: DirectoryJSON = {};
        // Create mock empty directories for all supported sizes
        for (const size of config.iconSizes) {
            fileStructureJson[`${size}`] = null;
        }
        vol.fromJSON(fileStructureJson, config.imageDir);
        fs = createFsFromVolume(vol);
        const TEST_PORT = 5000;
        app = startExpressServer(
            TEST_PORT,
            testDb,
            mockedChronikClient as unknown as ChronikClient,
            mockedTgBot as unknown as TelegramBot,
            fs,
            ecc,
            // We need higher rate limits so we do not rate limit ourselves in the tests
            rateLimit({
                windowMs: 60000,
                limit: 100, // Limit each IP to 10 requests per `window`
                standardHeaders: 'draft-7', // draft-6: `RateLimit-*` headers; draft-7: combined `RateLimit` header
                legacyHeaders: false, // Disable the `X-RateLimit-*` headers.
                message: 'You have rate limited your own unit tests.',
            }),
            // In tests, keep the same rate limits for token rewards
            rateLimit({
                windowMs: 60000,
                limit: 100, // Limit each IP to 10 requests per `window`
                standardHeaders: 'draft-7', // draft-6: `RateLimit-*` headers; draft-7: combined `RateLimit` header
                legacyHeaders: false, // Disable the `X-RateLimit-*` headers.
                message: 'You have rate limited your own unit tests.',
            }),
        );
        const TEST_PORT_BAD_DB = 5001;
        badDbApp = startExpressServer(
            TEST_PORT_BAD_DB,
            {} as unknown as Db,
            mockedChronikClient as unknown as ChronikClient,
            mockedTgBot as unknown as TelegramBot,
            fs,
            ecc,
            // We need higher rate limits so we do not rate limit ourselves in the tests
            rateLimit({
                windowMs: 60000,
                limit: 100, // Limit each IP to 10 requests per `window`
                standardHeaders: 'draft-7', // draft-6: `RateLimit-*` headers; draft-7: combined `RateLimit` header
                legacyHeaders: false, // Disable the `X-RateLimit-*` headers.
                message: 'You have rate limited your own unit tests.',
            }),
            // In tests, keep the same rate limits for token rewards
            rateLimit({
                windowMs: 60000,
                limit: 100, // Limit each IP to 10 requests per `window`
                standardHeaders: 'draft-7', // draft-6: `RateLimit-*` headers; draft-7: combined `RateLimit` header
                legacyHeaders: false, // Disable the `X-RateLimit-*` headers.
                message: 'You have rate limited your own unit tests.',
            }),
        );
    });
    afterEach(async () => {
        // Reset mocked fs
        vol.reset();
        // Stop express server
        app.close();
        badDbApp.close();
        // Wipe the database after each unit test
        await testDb.dropDatabase();
    });
    it('/status returns expected status', function () {
        return request(app)
            .get('/status')
            .expect(200)
            .expect('Content-Type', /json/)
            .expect({ status: 'running' });
    });
    it('/is-eligible/:address returns expected status for an ineligible address', function () {
        return request(app)
            .get(`/is-eligible/${INELIGIBLE_ADDRESS}`)
            .expect(200)
            .expect('Content-Type', /json/)
            .expect({
                address: INELIGIBLE_ADDRESS,
                isEligible: false,
                becomesEligible:
                    ineligibleTimeFirstSeen + config.eligibilityResetSeconds,
            });
    });
    it('/is-eligible/:address returns expected status for an eligible address', function () {
        return request(app)
            .get(`/is-eligible/${ELIGIBLE_ADDRESS}`)
            .expect(200)
            .expect('Content-Type', /json/)
            .expect({ address: ELIGIBLE_ADDRESS, isEligible: true });
    });
    it('/is-eligible/:address returns expected error status if called with invalid address', function () {
        return request(app)
            .get(`/is-eligible/${INVALID_ADDRESS}`)
            .expect(500)
            .expect('Content-Type', /json/)
            .expect({
                address: INVALID_ADDRESS,
                error: 'Invalid eCash address',
            });
    });
    it('/is-eligible/:address returns expected error status on chronik error determining eligibility', function () {
        return request(app)
            .get(`/is-eligible/${ERROR_ADDRESS}`)
            .expect(500)
            .expect('Content-Type', /json/)
            .expect({
                address: ERROR_ADDRESS,
                error: 'chronik error determining address eligibility',
            });
    });
    it('/claim/:address returns 500 and expected msg if there is an error checking the recaptcha', function () {
        const MOCK_RECAPTCHA_TOKEN = 'goodrecaptcha';

        // Mock successful recaptcha response
        // onNoMatch: 'throwException' helps to debug if mock is not being used
        const mock = new MockAdapter(axios, {
            onNoMatch: 'throwException',
        });

        // Mock a successful API request
        mock.onPost(config.recaptchaUrl).reply(500, new Error('some error'));

        return request(app)
            .post(`/claim/${USED_ADDRESS}`)
            .send({ token: MOCK_RECAPTCHA_TOKEN }) // send the request body
            .set('Content-Type', 'application/json') // set the Content-Type header
            .expect(500)
            .expect('Content-Type', /json/)
            .expect({
                address: USED_ADDRESS,
                error: `Error validating recaptcha response, please try again later`,
            });
    });
    it('/claim/:address returns 500 and expected msg if the recaptcha is invalid (google returns success: false)', function () {
        const MOCK_RECAPTCHA_TOKEN = 'badrecaptcha';

        // Mock successful recaptcha response
        // onNoMatch: 'throwException' helps to debug if mock is not being used
        const mock = new MockAdapter(axios, {
            onNoMatch: 'throwException',
        });

        // Mock a successful API request
        mock.onPost(config.recaptchaUrl).reply(200, { success: false });

        return request(app)
            .post(`/claim/${USED_ADDRESS}`)
            .send({ token: MOCK_RECAPTCHA_TOKEN }) // send the request body
            .set('Content-Type', 'application/json') // set the Content-Type header
            .expect(500)
            .expect('Content-Type', /json/)
            .expect({
                address: USED_ADDRESS,
                error: `Recaptcha check failed. Are you a bot?`,
            });
    });
    it('/claim/:address returns 500 and expected msg if recaptcha succeeds with insufficient score', function () {
        const MOCK_RECAPTCHA_TOKEN = 'badrecaptcha';

        // Mock successful recaptcha response
        // onNoMatch: 'throwException' helps to debug if mock is not being used
        const mock = new MockAdapter(axios, {
            onNoMatch: 'throwException',
        });

        // Mock a successful API request
        mock.onPost(config.recaptchaUrl).reply(200, {
            success: true,
            score: config.recaptchaThreshold - 0.01,
        });

        return request(app)
            .post(`/claim/${USED_ADDRESS}`)
            .send({ token: MOCK_RECAPTCHA_TOKEN }) // send the request body without a "token" key
            .set('Content-Type', 'application/json') // set the Content-Type header
            .expect(500)
            .expect('Content-Type', /json/)
            .expect({
                address: USED_ADDRESS,
                error: `Recaptcha check suspicious. Are you a bot?`,
                msg: `🤔`,
            });
    });
    it('/claim/:address returns expected status for an ineligible address', function () {
        const MOCK_RECAPTCHA_TOKEN = 'goodrecaptcha';
        // Mock successful recaptcha response
        // onNoMatch: 'throwException' helps to debug if mock is not being used
        const mock = new MockAdapter(axios, {
            onNoMatch: 'throwException',
        });

        // Mock a successful API request
        mock.onPost(config.recaptchaUrl).reply(200, {
            success: true,
            score: config.recaptchaThreshold,
        });

        return request(app)
            .post(`/claim/${INELIGIBLE_ADDRESS}`)
            .send({ token: MOCK_RECAPTCHA_TOKEN }) // send the request body
            .set('Content-Type', 'application/json') // set the Content-Type header
            .expect(500)
            .expect('Content-Type', /json/)
            .expect({
                address: INELIGIBLE_ADDRESS,
                error: `Address is not yet eligible for token rewards`,
                becomesEligible:
                    ineligibleTimeFirstSeen + config.eligibilityResetSeconds,
            });
    });
    it('/claim/:address returns expected error status if called with invalid address', function () {
        const MOCK_RECAPTCHA_TOKEN = 'goodrecaptcha';
        // Mock successful recaptcha response
        // onNoMatch: 'throwException' helps to debug if mock is not being used
        const mock = new MockAdapter(axios, {
            onNoMatch: 'throwException',
        });

        // Mock a successful API request
        mock.onPost(config.recaptchaUrl).reply(200, {
            success: true,
            score: config.recaptchaThreshold,
        });
        return request(app)
            .post(`/claim/${INVALID_ADDRESS}`)
            .send({ token: MOCK_RECAPTCHA_TOKEN }) // send the request body
            .set('Content-Type', 'application/json') // set the Content-Type header
            .expect(500)
            .expect('Content-Type', /json/)
            .expect({
                address: INVALID_ADDRESS,
                error: 'Invalid eCash address',
            });
    });
    it('/claim/:address returns expected error status on chronik error', function () {
        const MOCK_RECAPTCHA_TOKEN = 'goodrecaptcha';
        // Mock successful recaptcha response
        // onNoMatch: 'throwException' helps to debug if mock is not being used
        const mock = new MockAdapter(axios, {
            onNoMatch: 'throwException',
        });

        // Mock a successful API request
        mock.onPost(config.recaptchaUrl).reply(200, {
            success: true,
            score: config.recaptchaThreshold,
        });
        return request(app)
            .post(`/claim/${ERROR_ADDRESS}`)
            .send({ token: MOCK_RECAPTCHA_TOKEN }) // send the request body
            .set('Content-Type', 'application/json') // set the Content-Type header
            .expect(500)
            .expect('Content-Type', /json/)
            .expect({
                address: ERROR_ADDRESS,
                error: 'chronik error building token reward',
            });
    });
    it('/claim/:address returns expected status for an eligible address', function () {
        const MOCK_RECAPTCHA_TOKEN = 'goodrecaptcha';
        // Mock successful recaptcha response
        // onNoMatch: 'throwException' helps to debug if mock is not being used
        const mock = new MockAdapter(axios, {
            onNoMatch: 'throwException',
        });

        // Mock a successful API request
        mock.onPost(config.recaptchaUrl).reply(200, {
            success: true,
            score: config.recaptchaThreshold,
        });
        return request(app)
            .post(`/claim/${ELIGIBLE_ADDRESS}`)
            .send({ token: MOCK_RECAPTCHA_TOKEN }) // send the request body
            .set('Content-Type', 'application/json') // set the Content-Type header
            .expect(200)
            .expect('Content-Type', /json/)
            .expect({
                address: ELIGIBLE_ADDRESS,
                msg: 'Success',
                txid: '1b3cb86a06c64afdbad89ac3660ee724cbb8a5a1b099763b993d63b1285bb404',
            });
    });
    it('/claimxec/:address returns 500 and expected msg if there is an error checking the recaptcha', function () {
        const MOCK_RECAPTCHA_TOKEN = 'goodrecaptcha';

        // Mock successful recaptcha response
        // onNoMatch: 'throwException' helps to debug if mock is not being used
        const mock = new MockAdapter(axios, {
            onNoMatch: 'throwException',
        });

        // Mock a successful API request
        mock.onPost(config.recaptchaUrl).reply(500, new Error('some error'));

        return request(app)
            .post(`/claimxec/${USED_ADDRESS}`)
            .send({ token: MOCK_RECAPTCHA_TOKEN }) // send the request body
            .set('Content-Type', 'application/json') // set the Content-Type header
            .expect(500)
            .expect('Content-Type', /json/)
            .expect({
                address: USED_ADDRESS,
                error: `Error validating recaptcha response, please try again later`,
            });
    });
    it('/claimxec/:address returns 500 and expected msg if the recaptcha is invalid (google returns success: false)', function () {
        const MOCK_RECAPTCHA_TOKEN = 'badrecaptcha';

        // Mock successful recaptcha response
        // onNoMatch: 'throwException' helps to debug if mock is not being used
        const mock = new MockAdapter(axios, {
            onNoMatch: 'throwException',
        });

        // Mock a successful API request
        mock.onPost(config.recaptchaUrl).reply(200, { success: false });

        return request(app)
            .post(`/claimxec/${USED_ADDRESS}`)
            .send({ token: MOCK_RECAPTCHA_TOKEN }) // send the request body
            .set('Content-Type', 'application/json') // set the Content-Type header
            .expect(500)
            .expect('Content-Type', /json/)
            .expect({
                address: USED_ADDRESS,
                error: `Recaptcha check failed. Are you a bot?`,
            });
    });
    it('/claimxec/:address returns 500 and expected msg if recaptcha succeeds with insufficient score', function () {
        const MOCK_RECAPTCHA_TOKEN = 'badrecaptcha';

        // Mock successful recaptcha response
        // onNoMatch: 'throwException' helps to debug if mock is not being used
        const mock = new MockAdapter(axios, {
            onNoMatch: 'throwException',
        });

        // Mock a successful API request
        mock.onPost(config.recaptchaUrl).reply(200, {
            success: true,
            score: config.recaptchaThreshold - 0.01,
        });

        return request(app)
            .post(`/claimxec/${USED_ADDRESS}`)
            .send({ token: MOCK_RECAPTCHA_TOKEN }) // send the request body without a "token" key
            .set('Content-Type', 'application/json') // set the Content-Type header
            .expect(500)
            .expect('Content-Type', /json/)
            .expect({
                address: USED_ADDRESS,
                error: `Recaptcha check suspicious. Are you a bot?`,
                msg: `🤔`,
            });
    });
    it('/claimxec/:address returns 500 if called with an address that has tx history', function () {
        const MOCK_RECAPTCHA_TOKEN = 'goodrecaptcha';

        // Mock successful recaptcha response
        // onNoMatch: 'throwException' helps to debug if mock is not being used
        const mock = new MockAdapter(axios, {
            onNoMatch: 'throwException',
        });

        // Mock a successful API request
        mock.onPost(config.recaptchaUrl).reply(200, {
            success: true,
            score: config.recaptchaThreshold,
        });

        return request(app)
            .post(`/claimxec/${USED_ADDRESS}`)
            .send({ token: MOCK_RECAPTCHA_TOKEN }) // send the request body
            .set('Content-Type', 'application/json') // set the Content-Type header
            .expect(500)
            .expect('Content-Type', /json/)
            .expect({
                address: USED_ADDRESS,
                error: `Only unused addresses are eligible for XEC airdrops`,
            });
    });
    it('/claimxec/:address sends an airdrop if called with an address with no tx history', function () {
        const MOCK_RECAPTCHA_TOKEN = 'goodrecaptcha';

        // Mock successful recaptcha response
        // onNoMatch: 'throwException' helps to debug if mock is not being used
        const mock = new MockAdapter(axios, {
            onNoMatch: 'throwException',
        });

        // Mock a successful API request
        mock.onPost(config.recaptchaUrl).reply(200, {
            success: true,
            score: config.recaptchaThreshold,
        });

        return request(app)
            .post(`/claimxec/${NEW_ADDRESS}`)
            .send({ token: MOCK_RECAPTCHA_TOKEN }) // send the request body
            .set('Content-Type', 'application/json') // set the Content-Type header
            .expect(200)
            .expect('Content-Type', /json/)
            .expect({
                address: NEW_ADDRESS,
                msg: 'Success',
                txid: expectedXecAirdropTxid,
            });
    });
    it('/claimxec/:address returns expected error status on chronik error', function () {
        const MOCK_RECAPTCHA_TOKEN = 'goodrecaptcha';

        // Mock successful recaptcha response
        // onNoMatch: 'throwException' helps to debug if mock is not being used
        const mock = new MockAdapter(axios, {
            onNoMatch: 'throwException',
        });

        // Mock a successful API request
        mock.onPost(config.recaptchaUrl).reply(200, {
            success: true,
            score: config.recaptchaThreshold,
        });

        return request(app)
            .post(`/claimxec/${ERROR_ADDRESS}`)
            .send({ token: MOCK_RECAPTCHA_TOKEN }) // send the request body
            .set('Content-Type', 'application/json') // set the Content-Type header
            .expect(500)
            .expect('Content-Type', /json/)
            .expect({
                address: ERROR_ADDRESS,
                error: 'Error querying chronik for address history: Error: some chronik error',
            });
    });
    it('/claimxec/:address returns expected error status if called with invalid address', function () {
        const MOCK_RECAPTCHA_TOKEN = 'goodrecaptcha';

        // Mock successful recaptcha response
        // onNoMatch: 'throwException' helps to debug if mock is not being used
        const mock = new MockAdapter(axios, {
            onNoMatch: 'throwException',
        });

        // Mock a successful API request
        mock.onPost(config.recaptchaUrl).reply(200, {
            success: true,
            score: config.recaptchaThreshold,
        });

        return request(app)
            .post(`/claimxec/${INVALID_ADDRESS}`)
            .send({ token: MOCK_RECAPTCHA_TOKEN }) // send the request body
            .set('Content-Type', 'application/json') // set the Content-Type header
            .expect(500)
            .expect('Content-Type', /json/)
            .expect({
                address: INVALID_ADDRESS,
                error: 'Invalid eCash address',
            });
    });
    it('We get a rendered blockie for a valid token image request', function () {
        return request(app)
            .get(
                `/512/3fee3384150b030490b7bee095a63900f66a45f2d8e3002ae3cf17ce3ef4d109.png`,
            )
            .expect(200)
            .expect('Content-Type', /image\/png/);
    });
    it('We get a 404 for an invalid token icon requeset', function () {
        return request(app)
            .get(
                `/512/3fee3384150b030490b7bee095a63900f66a45f2d8e3002ae3cf17ce3ef4d109.jpg`,
            )
            .expect(404)
            .expect('Content-Type', /json/)
            .expect({
                error: 'Could not find /512/3fee3384150b030490b7bee095a63900f66a45f2d8e3002ae3cf17ce3ef4d109.jpg',
            });
    });
    it('We get a 404 for any request not handled by other endpoints', function () {
        return request(app)
            .get(`/some/request/test`)
            .expect(404)
            .expect('Content-Type', /json/)
            .expect({
                error: 'Could not find /some/request/test',
            });
    });
    it('We receive a 500 error if post has no file', function () {
        return request(app)
            .post(`/new`)
            .field('newTokenName', 'Test Token')
            .field('newTokenTicker', 'TST')
            .field('newTokenDecimals', 3)
            .field('newTokenDocumentUrl', 'https://cashtab.com/')
            .field('newTokenInitialQty', '10000')
            .field(
                'tokenId',
                '1111111111111111111111111111111111111111111111111111111111111111',
            )
            .attach(
                'tokenIcon',
                Buffer.alloc(config.maxUploadSize - 1, 1),
                // no file name
            )
            .expect(500)
            .expect('Content-Type', /json/)
            .expect({
                status: 'error',
                msg: `No file in "/new" token icon request`,
            });
    });
    it('We receive a 500 error if image upload exceeds server limit', function () {
        return request(app)
            .post(`/new`)
            .field('newTokenName', 'Test Token')
            .field('newTokenTicker', 'TST')
            .field('newTokenDecimals', 3)
            .field('newTokenDocumentUrl', 'https://cashtab.com/')
            .field('newTokenInitialQty', '10000')
            .field(
                'tokenId',
                '1111111111111111111111111111111111111111111111111111111111111111',
            )
            .attach(
                'tokenIcon',
                Buffer.alloc(config.maxUploadSize, 1),
                'mockicon.png',
            )
            .expect(500)
            .expect('Content-Type', 'text/html; charset=utf-8')
            .expect(/MulterError: File too large/);
    });
    it('We can accept a png upload and resize it on the server', async function () {
        // Create a mock 512x512 png that sharp can process
        const semiTransparentRedPng = await sharp({
            create: {
                width: 512,
                height: 512,
                channels: 4,
                background: { r: 255, g: 0, b: 0, alpha: 0.5 },
            },
        })
            .png()
            .toBuffer();

        return request(app)
            .post(`/new`)
            .field('newTokenName', 'Test Token')
            .field('newTokenTicker', 'TST')
            .field('newTokenDecimals', 3)
            .field('newTokenDocumentUrl', 'https://cashtab.com/')
            .field('newTokenInitialQty', '10000')
            .field(
                'tokenId',
                '1111111111111111111111111111111111111111111111111111111111111111',
            )
            .attach('tokenIcon', semiTransparentRedPng, 'mockicon.png')
            .expect(200)
            .expect('Content-Type', /json/)
            .expect({
                status: 'ok',
            });
    });
    it('We can accept a png upload from Cashtab extension and resize it on the server', async function () {
        // Create a mock 512x512 png that sharp can process
        const semiTransparentRedPng = await sharp({
            create: {
                width: 512,
                height: 512,
                channels: 4,
                background: { r: 255, g: 0, b: 0, alpha: 0.5 },
            },
        })
            .png()
            .toBuffer();

        return request(app)
            .post(`/new`)
            .set(
                'Origin',
                'chrome-extension://obldfcmebhllhjlhjbnghaipekcppeag',
            )
            .field('newTokenName', 'Test Token')
            .field('newTokenTicker', 'TST')
            .field('newTokenDecimals', 3)
            .field('newTokenDocumentUrl', 'https://cashtab.com/')
            .field('newTokenInitialQty', '10000')
            .field(
                'tokenId',
                '1111111111111111111111111111111111111111111111111111111111111111',
            )
            .attach('tokenIcon', semiTransparentRedPng, 'mockicon.png')
            .expect(200)
            .expect('Content-Type', /json/)
            .expect({
                status: 'ok',
            });
    });
    it('A png upload request from a non-whitelisted domain is rejected', async function () {
        // Create a mock 512x512 png that sharp can process
        const semiTransparentRedPng = await sharp({
            create: {
                width: 512,
                height: 512,
                channels: 4,
                background: { r: 255, g: 0, b: 0, alpha: 0.5 },
            },
        })
            .png()
            .toBuffer();

        return request(app)
            .post(`/new`)
            .set('Origin', 'https://notcashtab.com/')
            .field('newTokenName', 'Test Token')
            .field('newTokenTicker', 'TST')
            .field('newTokenDecimals', 3)
            .field('newTokenDocumentUrl', 'https://cashtab.com/')
            .field('newTokenInitialQty', '10000')
            .field(
                'tokenId',
                '1111111111111111111111111111111111111111111111111111111111111111',
            )
            .attach('tokenIcon', semiTransparentRedPng, 'mockicon.png')
            .expect(500)
            .expect('Content-Type', 'text/html; charset=utf-8')
            .expect(/Not allowed by CORS/);
    });
    it('If the token icon already exists on the server, the /new request is rejected', async function () {
        // Create a mock 512x512 png that sharp can process
        const semiTransparentRedPng = await sharp({
            create: {
                width: 512,
                height: 512,
                channels: 4,
                background: { r: 255, g: 0, b: 0, alpha: 0.5 },
            },
        })
            .png()
            .toBuffer();

        // First request is ok
        await request(app)
            .post(`/new`)
            .field('newTokenName', 'Test Token')
            .field('newTokenTicker', 'TST')
            .field('newTokenDecimals', 3)
            .field('newTokenDocumentUrl', 'https://cashtab.com/')
            .field('newTokenInitialQty', '10000')
            .field(
                'tokenId',
                '1111111111111111111111111111111111111111111111111111111111111111',
            )
            .attach('tokenIcon', semiTransparentRedPng, 'mockicon.png')
            .expect(200)
            .expect('Content-Type', /json/)
            .expect({
                status: 'ok',
            });

        // Now an identical request will fail
        return request(app)
            .post(`/new`)
            .field('newTokenName', 'Test Token')
            .field('newTokenTicker', 'TST')
            .field('newTokenDecimals', 3)
            .field('newTokenDocumentUrl', 'https://cashtab.com/')
            .field('newTokenInitialQty', '10000')
            .field(
                'tokenId',
                '1111111111111111111111111111111111111111111111111111111111111111',
            )
            .attach('tokenIcon', semiTransparentRedPng, 'mockicon.png')
            .expect(500)
            .expect('Content-Type', /json/)
            .expect({
                status: 'error',
                msg: `Token icon already exists for 1111111111111111111111111111111111111111111111111111111111111111`,
            });
    });
    it('We only accept pngs at the /new post endpoint', async function () {
        const semiTransparentRedJpg = await sharp({
            create: {
                width: 512,
                height: 512,
                channels: 4,
                background: { r: 255, g: 0, b: 0, alpha: 0.5 },
            },
        })
            .jpeg()
            .toBuffer();

        return request(app)
            .post(`/new`)
            .field('newTokenName', 'Test Token')
            .field('newTokenTicker', 'TST')
            .field('newTokenDecimals', 3)
            .field('newTokenDocumentUrl', 'https://cashtab.com/')
            .field('newTokenInitialQty', '10000')
            .field(
                'tokenId',
                '1111111111111111111111111111111111111111111111111111111111111111',
            )
            .attach('tokenIcon', semiTransparentRedJpg, 'mockicon.jpg')
            .expect(403)
            .expect('Content-Type', /json/)
            .expect({
                status: 'error',
                msg: 'Only .png files are allowed.',
            });
    });
    it('Error in sharp resize is handled', async function () {
        return request(app)
            .post(`/new`)
            .field('newTokenName', 'Test Token')
            .field('newTokenTicker', 'TST')
            .field('newTokenDecimals', 3)
            .field('newTokenDocumentUrl', 'https://cashtab.com/')
            .field('newTokenInitialQty', '10000')
            .field(
                'tokenId',
                '1111111111111111111111111111111111111111111111111111111111111111',
            )
            .attach(
                'tokenIcon',
                Buffer.alloc(config.maxUploadSize - 1, 1),
                'mockicon.png',
            )
            .expect(500)
            .expect('Content-Type', /json/)
            .expect({
                status: 'error',
                msg: 'Error resizing uploaded token icon',
            });
    });
    it('/blacklist returns tokenIds of the blacklist', function () {
        return request(app)
            .get(`/blacklist`)
            .expect(200)
            .expect('Content-Type', /json/)
            .expect({
                status: 'success',
                tokenIds: mockBlacklist.map(entry => entry.tokenId),
            });
    });
    it('/blacklist returns tokenIds of the blacklist', function () {
        return request(badDbApp)
            .get(`/blacklist`)
            .expect(500)
            .expect('Content-Type', /json/)
            .expect({
                status: 'error',
                message: 'Failed to retrieve tokenIds',
            });
    });
    it('/blacklist/:tokenId returns expected entry for a valid tokenId in the blacklist', function () {
        const tokenId = mockBlacklist[0].tokenId;
        return request(app)
            .get(`/blacklist/${tokenId}`)
            .expect(200)
            .expect('Content-Type', /json/)
            .expect({
                status: 'success',
                isBlacklisted: true,
                entry: mockBlacklist[0],
            });
    });
    it('/blacklist/:tokenId returns expected error for an invalid tokenId', function () {
        const tokenId = 'not a token id';
        return request(app)
            .get(`/blacklist/${tokenId}`)
            .expect(500)
            .expect('Content-Type', /json/)
            .expect({
                status: 'error',
                message: `Invalid tokenId: ${tokenId}`,
            });
    });
    it('/blacklist/:tokenId returns expected entry for a valid tokenId NOT in the blacklist', function () {
        const tokenId =
            '0000000000000000000000000000000000000000000000000000000000000000';
        return request(app)
            .get(`/blacklist/${tokenId}`)
            .expect(200)
            .expect('Content-Type', /json/)
            .expect({
                status: 'success',
                isBlacklisted: false,
            });
    });
    it('/blacklist/:tokenId returns expected error if database fails to lookup a valid tokenId', function () {
        const tokenId = mockBlacklist[0].tokenId;
        return request(badDbApp)
            .get(`/blacklist/${tokenId}`)
            .expect(500)
            .expect('Content-Type', /json/)
            .expect({
                status: 'error',
                message: `Failed to retrieve tokenId ${tokenId} from the database`,
            });
    });
});
