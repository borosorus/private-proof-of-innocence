"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const debug_1 = __importDefault(require("debug"));
const poi_node_request_1 = require("./poi-node-request");
const shared_models_1 = require("@railgun-community/shared-models");
const dbg = (0, debug_1.default)('test:main');
const main = async () => {
    try {
        const nodeURL = 'http://localhost:8080';
        const eventRange = await poi_node_request_1.POINodeRequest.getPOIListEventRange(nodeURL, shared_models_1.NetworkName.Ethereum, shared_models_1.TXIDVersion.V2_PoseidonMerkle, 'efc6ddb59c098a13fb2b618fdae94c1c3a807abc8fb1837c93620c9143ee9e88', 0, 10);
        dbg(eventRange);
    }
    catch (err) {
        dbg(err);
    }
};
main();
//# sourceMappingURL=main.js.map