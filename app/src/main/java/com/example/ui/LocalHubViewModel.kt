package com.example.ui

import android.app.Application
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import com.example.data.AppDatabase
import com.example.data.model.*
import com.example.data.repository.LocalHubRepository
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.*
import kotlinx.coroutines.launch
import java.text.DecimalFormat

enum class UserRole {
    BUYER,
    VENDOR,
    STAFF
}

enum class ThemePreference {
    SYSTEM,
    LIGHT,
    DARK
}

enum class BuyerFeedMode {
    VERTICAL_FEED,
    GRID_EXPLORE
}

data class UserAccount(
    val id: Long = 1,
    val name: String = "Fatima Shehu",
    val email: String = "buyer.shehu@localhub.ng",
    val role: UserRole = UserRole.BUYER,
    val isVerifiedMerchant: Boolean = false,
    val isAuthorizedStaff: Boolean = false,
    val assignedVendorId: Long? = null
)

data class MarketplaceUiState(
    val currentRole: UserRole = UserRole.BUYER,
    val currentAccount: UserAccount = UserAccount(
        id = 1,
        name = "Fatima Shehu",
        email = "buyer.shehu@localhub.ng",
        role = UserRole.BUYER,
        isVerifiedMerchant = false,
        isAuthorizedStaff = false
    ),
    val availableAccounts: List<UserAccount> = listOf(
        UserAccount(1, "Fatima Shehu (Lafia Buyer)", "buyer.shehu@localhub.ng", UserRole.BUYER, false, false),
        UserAccount(2, "Alhaji Haruna Dalhatu (Merchant)", "merchant.dalhatu@localhub.ng", UserRole.VENDOR, true, false, 1L),
        UserAccount(3, "Dr. Amina Audu (Staff Admin)", "staff.admin@localhub.ng", UserRole.STAFF, false, true)
    ),
    val showAccountSwitcherDialog: Boolean = false,
    val accessDeniedMessage: String? = null,
    val isOfflineMode: Boolean = false,
    val themePreference: ThemePreference = ThemePreference.SYSTEM,
    
    // Buyer State
    val feedMode: BuyerFeedMode = BuyerFeedMode.VERTICAL_FEED,
    val selectedCategory: String = "All",
    val searchQuery: String = "",
    val maxDistanceKm: Double = 15.0,
    val activeVideos: List<ProductVideo> = emptyList(),
    val cartItems: List<CartItem> = emptyList(),
    val buyerOrders: List<MarketOrder> = emptyList(),
    val selectedTrackingOrder: MarketOrder? = null,
    val checkoutCartItem: CartItem? = null,
    val checkoutBuyerName: String = "Fatima Shehu",
    val checkoutBuyerPhone: String = "0803 123 4567",
    val checkoutBuyerAddress: String = "Plot 12, Doma Road Crescent",
    val checkoutBuyerArea: String = "Doma Road",
    val selectedPaymentMethod: String = "Mock Bank Transfer",
    val isPaymentProcessing: Boolean = false,
    val lastCompletedOrder: MarketOrder? = null,
    val showCheckoutDialog: Boolean = false,
    val showOrderSuccessDialog: Boolean = false,
    val showDisputeDialog: Boolean = false,
    val selectedOrderForDispute: MarketOrder? = null,

    // AI Shopping Assistant State
    val aiMessages: List<AiChatMessage> = emptyList(),
    val aiInputText: String = "",
    val isAiThinking: Boolean = false,

    // Vendor State
    val selectedVendorId: Long = 1L, // Default to Dalhatu Araf Produce Hub
    val allVendors: List<Vendor> = emptyList(),
    val currentVendor: Vendor? = null,
    val vendorVideos: List<ProductVideo> = emptyList(),
    val vendorOrders: List<MarketOrder> = emptyList(),
    val vendorSettlementRequests: List<VendorSettlementRequest> = emptyList(),
    val showUploadVideoDialog: Boolean = false,
    val showSettlementDialog: Boolean = false,
    val settlementAmountInput: String = "25000",

    // Staff State
    val moderationVideos: List<ProductVideo> = emptyList(),
    val staffLedgerEntries: List<StaffLedgerEntry> = emptyList(),
    val allDisputes: List<MarketDispute> = emptyList(),
    val pendingSettlements: List<VendorSettlementRequest> = emptyList(),
    val totalPlatformCommissionNaira: Double = 0.0,
    val totalVendorPayoutsNaira: Double = 0.0,

    // Banner / Feedback Snackbar
    val snackbarMessage: String? = null
)

class LocalHubViewModel(application: Application) : AndroidViewModel(application) {

    private val database = AppDatabase.getDatabase(application, viewModelScope)
    val repository = LocalHubRepository(database.localHubDao())

    private val _uiState = MutableStateFlow(MarketplaceUiState())
    val uiState: StateFlow<MarketplaceUiState> = _uiState.asStateFlow()

    private val nairaFormat = DecimalFormat("#,##0")

    init {
        observeData()
    }

    private fun observeData() {
        // Observe Approved Videos for Buyer Feed
        viewModelScope.launch(Dispatchers.IO) {
            repository.approvedVideos.collect { videos ->
                _uiState.update { state ->
                    val filtered = filterVideos(videos, state.selectedCategory, state.searchQuery, state.maxDistanceKm)
                    state.copy(activeVideos = filtered)
                }
            }
        }

        // Observe Moderation Videos for Staff
        viewModelScope.launch(Dispatchers.IO) {
            repository.moderationVideos.collect { videos ->
                _uiState.update { it.copy(moderationVideos = videos) }
            }
        }

        // Observe Cart Items
        viewModelScope.launch(Dispatchers.IO) {
            repository.cartItems.collect { items ->
                _uiState.update { it.copy(cartItems = items) }
            }
        }

        // Observe All Orders
        viewModelScope.launch(Dispatchers.IO) {
            repository.allOrders.collect { orders ->
                _uiState.update { state ->
                    val vendorFiltered = orders.filter { it.vendorId == state.selectedVendorId }
                    state.copy(
                        buyerOrders = orders,
                        vendorOrders = vendorFiltered,
                        selectedTrackingOrder = state.selectedTrackingOrder?.let { selected ->
                            orders.find { it.id == selected.id } ?: selected
                        }
                    )
                }
            }
        }

        // Observe Vendors
        viewModelScope.launch(Dispatchers.IO) {
            repository.allVendors.collect { vendors ->
                _uiState.update { state ->
                    val current = vendors.find { it.id == state.selectedVendorId } ?: vendors.firstOrNull()
                    state.copy(
                        allVendors = vendors,
                        currentVendor = current
                    )
                }
            }
        }

        // Observe Staff Ledger Entries
        viewModelScope.launch(Dispatchers.IO) {
            repository.allLedgerEntries.collect { entries ->
                val totalCommission = entries.filter { it.type == "COMMISSION_EARNED" }.sumOf { it.commissionNaira }
                val totalPayouts = entries.filter { it.type == "VENDOR_PAYOUT_SETTLED" }.sumOf { it.totalOrderNaira }
                _uiState.update {
                    it.copy(
                        staffLedgerEntries = entries,
                        totalPlatformCommissionNaira = totalCommission,
                        totalVendorPayoutsNaira = totalPayouts
                    )
                }
            }
        }

        // Observe Settlements
        viewModelScope.launch(Dispatchers.IO) {
            repository.allSettlements.collect { settlements ->
                _uiState.update { state ->
                    val pending = settlements.filter { it.status == "PENDING" }
                    val vendorSpecific = settlements.filter { it.vendorId == state.selectedVendorId }
                    state.copy(
                        pendingSettlements = pending,
                        vendorSettlementRequests = vendorSpecific
                    )
                }
            }
        }

        // Observe Disputes
        viewModelScope.launch(Dispatchers.IO) {
            repository.allDisputes.collect { disputes ->
                _uiState.update { it.copy(allDisputes = disputes) }
            }
        }

        // Observe AI Chat Messages
        viewModelScope.launch(Dispatchers.IO) {
            repository.aiChatMessages.collect { msgs ->
                _uiState.update { it.copy(aiMessages = msgs) }
            }
        }
    }

    private fun filterVideos(
        all: List<ProductVideo>,
        category: String,
        query: String,
        maxDist: Double
    ): List<ProductVideo> {
        return all.filter { video ->
            val matchCategory = (category == "All" || video.category.equals(category, ignoreCase = true))
            val matchQuery = query.isBlank() ||
                    video.title.contains(query, ignoreCase = true) ||
                    video.description.contains(query, ignoreCase = true) ||
                    video.vendorName.contains(query, ignoreCase = true)
            val matchDist = video.distanceKmFromUser <= maxDist
            matchCategory && matchQuery && matchDist
        }
    }

    // --- Role Switching & Authenticated Access Control ---
    fun setRole(role: UserRole) {
        val account = _uiState.value.currentAccount
        val isAllowed = when (role) {
            UserRole.BUYER -> true
            UserRole.VENDOR -> account.role == UserRole.VENDOR || account.isVerifiedMerchant
            UserRole.STAFF -> account.role == UserRole.STAFF || account.isAuthorizedStaff
        }
        if (!isAllowed) {
            val deniedMsg = "Access Denied: Account '${account.email}' does not have ${role.name} credentials. Switch account to an authorized user."
            _uiState.update { it.copy(snackbarMessage = deniedMsg, accessDeniedMessage = deniedMsg) }
            return
        }
        _uiState.update { it.copy(currentRole = role, accessDeniedMessage = null) }
    }

    fun toggleAccountSwitcherDialog(show: Boolean) {
        _uiState.update { it.copy(showAccountSwitcherDialog = show) }
    }

    fun switchAccount(account: UserAccount) {
        _uiState.update {
            it.copy(
                currentAccount = account,
                currentRole = account.role,
                selectedVendorId = account.assignedVendorId ?: it.selectedVendorId,
                showAccountSwitcherDialog = false,
                accessDeniedMessage = null
            )
        }
        showSnackbar("Authenticated as ${account.name} (${account.role.name})")
    }

    fun clearAccessDeniedMessage() {
        _uiState.update { it.copy(accessDeniedMessage = null) }
    }

    fun toggleOfflineSimulation() {
        _uiState.update {
            val next = !it.isOfflineMode
            it.copy(
                isOfflineMode = next,
                snackbarMessage = if (next) "Network offline simulated. Local database cache active." else "Network restored. Synced with local store."
            )
        }
    }

    // --- Theme Switching ---
    fun setThemePreference(theme: ThemePreference) {
        _uiState.update { it.copy(themePreference = theme) }
    }

    // --- Buyer Feed & Filter Controls ---
    fun setFeedMode(mode: BuyerFeedMode) {
        _uiState.update { it.copy(feedMode = mode) }
    }

    fun setSelectedCategory(category: String) {
        _uiState.update { it.copy(selectedCategory = category) }
        refreshFilteredVideos()
    }

    fun setSearchQuery(query: String) {
        _uiState.update { it.copy(searchQuery = query) }
        refreshFilteredVideos()
    }

    fun setMaxDistanceKm(km: Double) {
        _uiState.update { it.copy(maxDistanceKm = km) }
        refreshFilteredVideos()
    }

    private fun refreshFilteredVideos() {
        viewModelScope.launch(Dispatchers.IO) {
            repository.approvedVideos.firstOrNull()?.let { all ->
                _uiState.update { state ->
                    val filtered = filterVideos(all, state.selectedCategory, state.searchQuery, state.maxDistanceKm)
                    state.copy(activeVideos = filtered)
                }
            }
        }
    }

    // --- Cart Actions ---
    fun addToCart(video: ProductVideo, quantity: Int = 1) {
        viewModelScope.launch(Dispatchers.IO) {
            repository.addToCart(video, quantity)
            showSnackbar("Added '${video.title}' to cart (₦${nairaFormat.format(video.priceNaira)})")
        }
    }

    fun removeFromCart(cartItemId: Long) {
        viewModelScope.launch(Dispatchers.IO) {
            repository.removeFromCart(cartItemId)
        }
    }

    // --- Complete Journey Step 1: Prepare & Confirm Checkout ---
    fun initiateCheckoutForCartItem(item: CartItem) {
        _uiState.update {
            it.copy(
                checkoutCartItem = item,
                showCheckoutDialog = true
            )
        }
    }

    fun initiateCheckoutForProduct(video: ProductVideo) {
        val tempCartItem = CartItem(
            productId = video.id,
            vendorId = video.vendorId,
            vendorName = video.vendorName,
            productTitle = video.title,
            priceNaira = video.priceNaira,
            quantity = 1,
            distanceKm = video.distanceKmFromUser,
            deliveryRadiusKm = video.deliveryRadiusKm,
            category = video.category,
            themeColor = video.videoGradientStart
        )
        _uiState.update {
            it.copy(
                checkoutCartItem = tempCartItem,
                showCheckoutDialog = true
            )
        }
    }

    fun initiateCheckoutFromAiDraft(msg: AiChatMessage) {
        if (!msg.hasDraftOrder || msg.draftProductId == null) return
        val tempCartItem = CartItem(
            productId = msg.draftProductId,
            vendorId = msg.draftVendorId ?: 1,
            vendorName = msg.draftVendorName ?: "Dalhatu Araf Fresh Produce Hub",
            productTitle = msg.draftProductTitle ?: "Lafia Product",
            priceNaira = msg.draftPriceNaira ?: 14500.0,
            quantity = msg.draftQuantity,
            distanceKm = msg.draftDistanceKm ?: 1.8,
            deliveryRadiusKm = 10.0,
            category = "Produce",
            themeColor = 0xFF059669
        )
        _uiState.update {
            it.copy(
                checkoutCartItem = tempCartItem,
                showCheckoutDialog = true
            )
        }
    }

    fun updateCheckoutForm(
        name: String,
        phone: String,
        address: String,
        area: String,
        paymentMethod: String
    ) {
        _uiState.update {
            it.copy(
                checkoutBuyerName = name,
                checkoutBuyerPhone = phone,
                checkoutBuyerAddress = address,
                checkoutBuyerArea = area,
                selectedPaymentMethod = paymentMethod
            )
        }
    }

    fun closeCheckoutDialog() {
        _uiState.update { it.copy(showCheckoutDialog = false) }
    }

    // --- Complete Journey Step 2: Explicit Buyer Mock Payment Confirmation ---
    fun confirmAndPayMockOrder(customIdempotencyKey: String? = null) {
        val item = _uiState.value.checkoutCartItem ?: return
        val state = _uiState.value
        val idempotencyKey = customIdempotencyKey ?: "IDEMP-${item.productId}-${item.quantity}-${System.currentTimeMillis() / 30000}"

        _uiState.update { it.copy(isPaymentProcessing = true) }

        viewModelScope.launch(Dispatchers.IO) {
            val createdOrder = repository.placeOrderWithMockPayment(
                buyerName = state.checkoutBuyerName,
                buyerPhone = state.checkoutBuyerPhone,
                buyerAddress = state.checkoutBuyerAddress,
                buyerArea = state.checkoutBuyerArea,
                cartItem = item,
                paymentMethod = state.selectedPaymentMethod,
                idempotencyKey = idempotencyKey
            )

            _uiState.update {
                it.copy(
                    isPaymentProcessing = false,
                    showCheckoutDialog = false,
                    lastCompletedOrder = createdOrder,
                    selectedTrackingOrder = createdOrder,
                    showOrderSuccessDialog = true
                )
            }
            showSnackbar("Order placed & mock payment verified! Order #${createdOrder.orderNumber}")
        }
    }

    fun dismissOrderSuccessDialog() {
        _uiState.update { it.copy(showOrderSuccessDialog = false) }
    }

    fun selectOrderForTracking(order: MarketOrder) {
        _uiState.update { it.copy(selectedTrackingOrder = order) }
    }

    // --- Complete Journey Step 3: Vendor Accepts Order ---
    fun vendorAcceptOrder(orderId: Long) {
        viewModelScope.launch(Dispatchers.IO) {
            repository.vendorAcceptOrder(orderId)
            showSnackbar("Order accepted! Kitchen/Store is preparing items.")
        }
    }

    // --- Complete Journey Step 4: Vendor Dispatches Order ---
    fun vendorDispatchOrder(orderId: Long, riderName: String = "Musa Ibrahim (Lafia Express)", riderPhone: String = "0803 456 7890") {
        viewModelScope.launch(Dispatchers.IO) {
            repository.vendorDispatchOrder(orderId, riderName, riderPhone)
            showSnackbar("Order handed to dispatch rider ($riderName). Out for delivery!")
        }
    }

    // --- Complete Journey Step 5: Mark Order Delivered & Record 5% Commission ---
    fun markOrderDelivered(orderId: Long) {
        viewModelScope.launch(Dispatchers.IO) {
            repository.markOrderDelivered(orderId)
            showSnackbar("Delivery confirmed! 5% Commission recorded in Staff Ledger.")
        }
    }

    // --- Vendor Management ---
    fun setSelectedVendor(vendorId: Long) {
        _uiState.update { state ->
            val vendor = state.allVendors.find { it.id == vendorId }
            state.copy(
                selectedVendorId = vendorId,
                currentVendor = vendor,
                vendorOrders = state.buyerOrders.filter { it.vendorId == vendorId },
                vendorSettlementRequests = state.pendingSettlements.filter { it.vendorId == vendorId }
            )
        }
    }

    fun toggleUploadVideoDialog(show: Boolean) {
        _uiState.update { it.copy(showUploadVideoDialog = show) }
    }

    fun uploadProductVideo(
        title: String,
        description: String,
        category: String,
        priceNaira: Double,
        stock: Int,
        radiusKm: Double
    ) {
        val vendorId = _uiState.value.selectedVendorId
        viewModelScope.launch(Dispatchers.IO) {
            repository.uploadProductVideo(
                vendorId = vendorId,
                title = title,
                description = description,
                category = category,
                priceNaira = priceNaira,
                stockQuantity = stock,
                deliveryRadiusKm = radiusKm
            )
            _uiState.update { it.copy(showUploadVideoDialog = false) }
            showSnackbar("Product video '$title' published to Lafia marketplace!")
        }
    }

    fun toggleSettlementDialog(show: Boolean) {
        _uiState.update { it.copy(showSettlementDialog = show) }
    }

    fun requestSettlementPayout(amountNaira: Double) {
        val vendorId = _uiState.value.selectedVendorId
        viewModelScope.launch(Dispatchers.IO) {
            repository.requestVendorSettlement(vendorId, amountNaira)
            _uiState.update { it.copy(showSettlementDialog = false) }
            showSnackbar("Settlement request for ₦${nairaFormat.format(amountNaira)} submitted to Staff Ledger!")
        }
    }

    // --- Staff Controls ---
    fun verifyVendor(vendorId: Long, isApproved: Boolean) {
        viewModelScope.launch(Dispatchers.IO) {
            val status = if (isApproved) "VERIFIED" else "SUSPENDED"
            repository.updateVendorVerification(vendorId, status)
            showSnackbar("Vendor verification updated: $status")
        }
    }

    fun moderateVideo(videoId: Long, newStatus: String, reason: String? = null) {
        viewModelScope.launch(Dispatchers.IO) {
            repository.moderateVideo(videoId, newStatus, reason)
            showSnackbar("Video status updated to $newStatus")
        }
    }

    fun approveSettlementRequest(request: VendorSettlementRequest) {
        viewModelScope.launch(Dispatchers.IO) {
            repository.approveSettlementRequest(request)
            showSnackbar("Payout of ₦${nairaFormat.format(request.amountNaira)} approved & processed to ${request.bankName}")
        }
    }

    fun openDisputeDialog(order: MarketOrder) {
        _uiState.update {
            it.copy(
                selectedOrderForDispute = order,
                showDisputeDialog = true
            )
        }
    }

    fun closeDisputeDialog() {
        _uiState.update { it.copy(showDisputeDialog = false) }
    }

    fun submitDispute(
        order: MarketOrder,
        category: String,
        description: String
    ) {
        viewModelScope.launch(Dispatchers.IO) {
            val dispute = MarketDispute(
                orderId = order.id,
                orderNumber = order.orderNumber,
                buyerName = order.buyerName,
                vendorName = order.vendorName,
                issueCategory = category,
                issueDescription = description,
                amountNaira = order.totalNaira,
                status = "OPEN"
            )
            repository.updateDisputeDirect(dispute)
            _uiState.update { it.copy(showDisputeDialog = false) }
            showSnackbar("Dispute for Order #${order.orderNumber} lodged with Lafia Staff Resolution Center.")
        }
    }

    fun resolveDispute(dispute: MarketDispute, outcome: String, note: String) {
        viewModelScope.launch(Dispatchers.IO) {
            val updated = dispute.copy(
                status = outcome,
                resolutionNote = note
            )
            repository.updateDisputeDirect(updated)
            showSnackbar("Dispute for #${dispute.orderNumber} resolved ($outcome)")
        }
    }

    // --- AI Shopping Assistant Chat ---
    fun updateAiInput(text: String) {
        _uiState.update { it.copy(aiInputText = text) }
    }

    fun sendAiPrompt() {
        val query = _uiState.value.aiInputText.trim()
        if (query.isBlank()) return

        _uiState.update { it.copy(aiInputText = "", isAiThinking = true) }

        viewModelScope.launch(Dispatchers.IO) {
            repository.processAiUserPrompt(query)
            _uiState.update { it.copy(isAiThinking = false) }
        }
    }

    // --- Notifications ---
    fun showSnackbar(message: String) {
        _uiState.update { it.copy(snackbarMessage = message) }
    }

    fun clearSnackbar() {
        _uiState.update { it.copy(snackbarMessage = null) }
    }
}
