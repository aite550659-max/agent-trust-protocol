// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.20;

/**
 * ATP Escrow — Agent Trust Protocol Settlement Contract
 * 
 * Handles escrow deposit, fee split distribution, timeout refunds,
 * and rental state management.
 *
 * Fee splits (basis points):
 *   Owner:    9200 (92%)
 *   Creator:   500 (5%)
 *   Network:   200 (2%)
 *   Treasury:  100 (1%)
 *
 * Copyright 2026 Gregory L. Bell. Apache-2.0 License.
 */

contract ATPEscrow {
    // --- Constants ---
    uint16 public constant OWNER_BPS = 9200;
    uint16 public constant CREATOR_BPS = 500;
    uint16 public constant NETWORK_BPS = 200;
    uint16 public constant TREASURY_BPS = 100;
    uint16 public constant TOTAL_BPS = 10000;

    // --- Immutable config ---
    address payable public networkAddress;
    address payable public treasuryAddress;
    address public admin; // protocol admin (timelock upgrade path later)

    // --- Rental states ---
    enum RentalStatus { None, Active, Completed, Terminated, TimedOut }

    struct Rental {
        string rentalId;
        address payable renter;
        address payable owner;
        address payable creator;
        uint256 stakeAmount;      // in tinybars (msg.value on Hedera EVM)
        uint256 bufferAmount;     // in tinybars
        uint256 totalEscrowed;    // stakeAmount + bufferAmount
        uint64 startedAt;         // unix timestamp
        uint64 timeoutAt;         // unix timestamp — renter can claim after this
        uint64 settlementDeadline; // unix timestamp — owner can still settle until this
        RentalStatus status;
    }

    // --- Storage ---
    mapping(bytes32 => Rental) public rentals;
    uint256 public rentalCount;

    // --- Pull Pattern: Withdrawable Balances ---
    // Hedera EVM cannot push HBAR via .call{value}(). 
    // Instead, we credit balances and let recipients withdraw.
    mapping(address => uint256) public withdrawable;

    // --- Events ---
    event RentalInitiated(
        bytes32 indexed rentalHash,
        string rentalId,
        address indexed renter,
        address indexed owner,
        address creator,
        uint256 totalEscrowed,
        uint64 timeoutAt
    );

    event RentalCompleted(
        bytes32 indexed rentalHash,
        uint256 ownerPayout,
        uint256 creatorPayout,
        uint256 networkPayout,
        uint256 treasuryPayout,
        uint256 renterRefund
    );

    event RentalTerminated(
        bytes32 indexed rentalHash,
        address terminatedBy,
        uint256 chargedAmount,
        uint256 renterRefund
    );

    event RentalTimeoutClaimed(
        bytes32 indexed rentalHash,
        address indexed renter,
        uint256 refundAmount
    );

    event BalanceCredited(
        address indexed recipient,
        uint256 amount,
        bytes32 indexed rentalHash
    );

    event Withdrawn(
        address indexed recipient,
        uint256 amount
    );

    // --- Modifiers ---
    modifier onlyAdmin() {
        require(msg.sender == admin, "ATP: not admin");
        _;
    }

    modifier onlyRenter(bytes32 rentalHash) {
        require(msg.sender == rentals[rentalHash].renter, "ATP: not renter");
        _;
    }

    modifier onlyOwner(bytes32 rentalHash) {
        require(msg.sender == rentals[rentalHash].owner, "ATP: not owner");
        _;
    }

    modifier onlyActive(bytes32 rentalHash) {
        require(rentals[rentalHash].status == RentalStatus.Active, "ATP: rental not active");
        _;
    }

    // --- Constructor ---
    constructor(address payable _networkAddress, address payable _treasuryAddress) {
        require(_networkAddress != address(0), "ATP: zero network address");
        require(_treasuryAddress != address(0), "ATP: zero treasury address");
        networkAddress = _networkAddress;
        treasuryAddress = _treasuryAddress;
        admin = msg.sender;
    }

    // --- Core Functions ---

    /**
     * Initiate a rental. Renter deposits stake + buffer.
     * @param rentalId Unique rental identifier
     * @param owner Agent owner address
     * @param creator Agent creator address (receives royalty)
     * @param stakeAmount Stake portion in tinybars
     * @param timeoutAt Unix timestamp when renter can claim timeout refund
     * @param settlementDeadline Unix timestamp when owner settlement window closes
     */
    function initiate(
        string calldata rentalId,
        address payable owner,
        address payable creator,
        uint256 stakeAmount,
        uint64 timeoutAt,
        uint64 settlementDeadline
    ) external payable {
        require(msg.value > 0, "ATP: zero escrow");
        require(owner != address(0), "ATP: zero owner");
        require(creator != address(0), "ATP: zero creator");
        require(stakeAmount <= msg.value, "ATP: stake exceeds deposit");
        require(timeoutAt > block.timestamp, "ATP: timeout in past");
        require(settlementDeadline > timeoutAt, "ATP: deadline before timeout");

        bytes32 rentalHash = keccak256(abi.encodePacked(rentalId));
        require(rentals[rentalHash].status == RentalStatus.None, "ATP: rental exists");

        rentals[rentalHash] = Rental({
            rentalId: rentalId,
            renter: payable(msg.sender),
            owner: owner,
            creator: creator,
            stakeAmount: stakeAmount,
            bufferAmount: msg.value - stakeAmount,
            totalEscrowed: msg.value,
            startedAt: uint64(block.timestamp),
            timeoutAt: timeoutAt,
            settlementDeadline: settlementDeadline,
            status: RentalStatus.Active
        });

        rentalCount++;

        emit RentalInitiated(
            rentalHash,
            rentalId,
            msg.sender,
            owner,
            creator,
            msg.value,
            timeoutAt
        );
    }

    /**
     * Complete a rental with usage settlement.
     * Callable by owner or admin.
     * @param rentalHash Hash of the rental ID
     * @param usageAmount Amount consumed from buffer (in tinybars)
     */
    function complete(
        bytes32 rentalHash,
        uint256 usageAmount
    ) external onlyActive(rentalHash) {
        Rental storage rental = rentals[rentalHash];
        require(
            msg.sender == rental.owner || msg.sender == admin,
            "ATP: not owner or admin"
        );

        // If past timeout, must be within settlement deadline
        if (block.timestamp > rental.timeoutAt) {
            require(
                block.timestamp <= rental.settlementDeadline,
                "ATP: settlement deadline passed"
            );
        }

        // Cap usage to buffer
        uint256 charged = usageAmount > rental.bufferAmount ? rental.bufferAmount : usageAmount;

        _settle(rentalHash, charged, RentalStatus.Completed);
    }

    /**
     * Terminate a rental early. Callable by renter or owner.
     * Charges base fee only (minimum usage).
     * @param rentalHash Hash of the rental ID
     * @param baseFeeAmount Base fee to charge (in tinybars)
     */
    function terminate(
        bytes32 rentalHash,
        uint256 baseFeeAmount
    ) external onlyActive(rentalHash) {
        Rental storage rental = rentals[rentalHash];
        require(
            msg.sender == rental.renter || msg.sender == rental.owner,
            "ATP: not renter or owner"
        );

        uint256 charged = baseFeeAmount > rental.bufferAmount ? rental.bufferAmount : baseFeeAmount;

        _settle(rentalHash, charged, RentalStatus.Terminated);

        emit RentalTerminated(
            rentalHash,
            msg.sender,
            charged,
            rental.stakeAmount + (rental.bufferAmount - charged)
        );
    }

    /**
     * Claim timeout refund as renter.
     * Available after timeoutAt, returns full escrow minus minimal protocol fees.
     * Credits renter's withdrawable balance; minimal fees credited to network/treasury.
     * @param rentalHash Hash of the rental ID
     */
    function claimTimeout(
        bytes32 rentalHash
    ) external onlyActive(rentalHash) onlyRenter(rentalHash) {
        Rental storage rental = rentals[rentalHash];
        require(block.timestamp > rental.timeoutAt, "ATP: not timed out yet");

        // Minimal fee: network + treasury on buffer only
        uint256 minFeeAmount = (rental.bufferAmount * (NETWORK_BPS + TREASURY_BPS)) / TOTAL_BPS;
        uint256 networkFee = (minFeeAmount * NETWORK_BPS) / (NETWORK_BPS + TREASURY_BPS);
        uint256 treasuryFee = minFeeAmount - networkFee;
        uint256 renterRefund = rental.totalEscrowed - networkFee - treasuryFee;

        rental.status = RentalStatus.TimedOut;

        // Credit balances (pull pattern)
        _credit(networkAddress, networkFee, rentalHash);
        _credit(treasuryAddress, treasuryFee, rentalHash);
        _credit(rental.renter, renterRefund, rentalHash);

        emit RentalTimeoutClaimed(rentalHash, rental.renter, renterRefund);
    }

    // --- Internal ---

    /**
     * Execute settlement: distribute charged amount per fee splits,
     * return stake + unused buffer to renter.
     *
     * PULL PATTERN: All amounts are credited to withdrawable balances.
     * Recipients call withdraw() to claim their HBAR.
     * This avoids Hedera EVM limitations with .call{value}() transfers
     * and prevents reentrancy attacks.
     */
    function _settle(
        bytes32 rentalHash,
        uint256 chargedAmount,
        RentalStatus newStatus
    ) internal {
        Rental storage rental = rentals[rentalHash];

        // Calculate splits on charged amount
        uint256 ownerPayout = (chargedAmount * OWNER_BPS) / TOTAL_BPS;
        uint256 creatorPayout = (chargedAmount * CREATOR_BPS) / TOTAL_BPS;
        uint256 networkPayout = (chargedAmount * NETWORK_BPS) / TOTAL_BPS;
        uint256 treasuryPayout = chargedAmount - ownerPayout - creatorPayout - networkPayout; // absorb dust

        // Renter gets stake + unused buffer
        uint256 renterRefund = rental.totalEscrowed - chargedAmount;

        rental.status = newStatus;

        // Credit all balances (pull pattern — no push transfers)
        _credit(rental.owner, ownerPayout, rentalHash);
        _credit(rental.creator, creatorPayout, rentalHash);
        _credit(networkAddress, networkPayout, rentalHash);
        _credit(treasuryAddress, treasuryPayout, rentalHash);
        _credit(rental.renter, renterRefund, rentalHash);

        emit RentalCompleted(
            rentalHash,
            ownerPayout,
            creatorPayout,
            networkPayout,
            treasuryPayout,
            renterRefund
        );
    }

    /**
     * Credit an amount to a recipient's withdrawable balance.
     */
    function _credit(address recipient, uint256 amount, bytes32 rentalHash) internal {
        if (amount > 0) {
            withdrawable[recipient] += amount;
            emit BalanceCredited(recipient, amount, rentalHash);
        }
    }

    /**
     * Withdraw all credited balance. Callable by anyone with a balance.
     * Uses checks-effects-interactions pattern to prevent reentrancy.
     */
    function withdraw() external {
        uint256 amount = withdrawable[msg.sender];
        require(amount > 0, "ATP: nothing to withdraw");

        // Effects before interactions (reentrancy safe)
        withdrawable[msg.sender] = 0;

        // Transfer HBAR to caller
        (bool success, ) = payable(msg.sender).call{value: amount}("");
        require(success, "ATP: withdrawal failed");

        emit Withdrawn(msg.sender, amount);
    }

    /**
     * Admin can withdraw on behalf of system accounts (e.g., 0.0.800)
     * that cannot call withdraw() themselves.
     * Funds are sent to admin; admin handles forwarding via Hedera SDK.
     */
    function withdrawFor(address account) external onlyAdmin {
        uint256 amount = withdrawable[account];
        require(amount > 0, "ATP: nothing to withdraw");

        withdrawable[account] = 0;

        (bool success, ) = payable(admin).call{value: amount}("");
        require(success, "ATP: withdrawal failed");

        emit Withdrawn(account, amount);
    }

    // --- View Functions ---

    function getRental(bytes32 rentalHash) external view returns (Rental memory) {
        return rentals[rentalHash];
    }

    function getRentalHash(string calldata rentalId) external pure returns (bytes32) {
        return keccak256(abi.encodePacked(rentalId));
    }

    function isTimedOut(bytes32 rentalHash) external view returns (bool) {
        Rental storage rental = rentals[rentalHash];
        return rental.status == RentalStatus.Active && block.timestamp > rental.timeoutAt;
    }

    function isInSettlementWindow(bytes32 rentalHash) external view returns (bool) {
        Rental storage rental = rentals[rentalHash];
        return rental.status == RentalStatus.Active 
            && block.timestamp > rental.timeoutAt 
            && block.timestamp <= rental.settlementDeadline;
    }

    // --- Admin ---

    function updateAdmin(address newAdmin) external onlyAdmin {
        require(newAdmin != address(0), "ATP: zero admin");
        admin = newAdmin;
    }

    // Allow contract to receive HBAR
    receive() external payable {}
    fallback() external payable {}
}
