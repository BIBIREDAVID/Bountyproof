// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

contract BountyProofTreasury {
    struct ProofRecord {
        bytes32 bountyIdHash;
        bytes32 submissionIdHash;
        bytes32 verificationIdHash;
        bytes32 proofHash;
        bool approved;
        address signer;
        uint256 recordedAt;
    }

    address public immutable admin;
    uint256 public immutable chainIdPinned;
    string public contractVersion;

    mapping(bytes32 => ProofRecord) private proofRecords;
    mapping(bytes32 => bool) public payoutEligible;

    event ProofRecorded(
        bytes32 indexed bountyIdHash,
        bytes32 indexed submissionIdHash,
        bytes32 indexed verificationIdHash,
        bytes32 proofHash,
        bool approved,
        address signer,
        uint256 recordedAt
    );

    event PayoutEligibilityUpdated(
        bytes32 indexed bountyIdHash,
        bool eligible,
        address signer,
        uint256 recordedAt
    );

    modifier onlyAdmin() {
        require(msg.sender == admin, "BountyProofTreasury: only admin");
        _;
    }

    constructor(address admin_, uint256 chainId_, string memory contractVersion_) {
        require(admin_ != address(0), "BountyProofTreasury: admin required");
        admin = admin_;
        chainIdPinned = chainId_;
        contractVersion = contractVersion_;
    }

    function hashId(string memory value) public pure returns (bytes32) {
        return keccak256(bytes(value));
    }

    function recordProof(
        string calldata bountyId,
        string calldata submissionId,
        string calldata verificationId,
        bytes32 proofHash,
        bool approved
    ) external onlyAdmin returns (bytes32 bountyIdHash, bytes32 submissionIdHash, bytes32 verificationIdHash) {
        bountyIdHash = hashId(bountyId);
        submissionIdHash = hashId(submissionId);
        verificationIdHash = hashId(verificationId);

        ProofRecord memory record = ProofRecord({
            bountyIdHash: bountyIdHash,
            submissionIdHash: submissionIdHash,
            verificationIdHash: verificationIdHash,
            proofHash: proofHash,
            approved: approved,
            signer: msg.sender,
            recordedAt: block.timestamp
        });

        proofRecords[bountyIdHash] = record;
        emit ProofRecorded(
            bountyIdHash,
            submissionIdHash,
            verificationIdHash,
            proofHash,
            approved,
            msg.sender,
            block.timestamp
        );
    }

    function setPayoutEligible(string calldata bountyId, bool eligible) external onlyAdmin {
        bytes32 bountyIdHash = hashId(bountyId);
        payoutEligible[bountyIdHash] = eligible;
        emit PayoutEligibilityUpdated(bountyIdHash, eligible, msg.sender, block.timestamp);
    }

    function getProofRecord(bytes32 bountyIdHash) external view returns (ProofRecord memory) {
        return proofRecords[bountyIdHash];
    }
}
