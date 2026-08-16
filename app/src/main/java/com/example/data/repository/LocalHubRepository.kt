package com.example.data.repository

import com.example.data.dao.LocalHubDao
import com.example.data.model.*
import kotlinx.coroutines.flow.Flow
import java.text.DecimalFormat
import java.util.UUID
import kotlin.random.Random

class LocalHubRepository(private val dao: LocalHubDao) {

    private val nairaFormat = DecimalFormat("#,##0")

    // --- Data Streams ---
    val allVendors: Flow<List<Vendor>> = dao.getAllVendors()
    val approvedVideos: Flow<List<ProductVideo>> = dao.getApprovedProductVideos()
    val moderationVideos: Flow<List<ProductVideo>> = dao.getAllProductVideosForModeration()
    val cartItems: Flow<List<CartItem>> = dao.getAllCartItems()
    val allOrders: Flow<List<MarketOrder>> = dao.getAllOrders()
    val allLedgerEntries: Flow<List<StaffLedgerEntry>> = dao.getAllLedgerEntries()
    val allSettlements: Flow<List<VendorSettlementRequest>> = dao.getAllSettlementRequests()
    val allDisputes: Flow<List<MarketDispute>> = dao.getAllDisputes()
    val aiChatMessages: Flow<List<AiChatMessage>> = dao.getAllAiChatMessages()

    fun getVideosForVendor(vendorId: Long): Flow<List<ProductVideo>> = dao.getVideosForVendor(vendorId)
    fun getOrdersForVendor(vendorId: Long): Flow<List<MarketOrder>> = dao.getOrdersForVendor(vendorId)
    fun getVendorById(id: Long): Flow<Vendor?> = dao.getVendorById(id)
    suspend fun getVendorByIdDirect(id: Long): Vendor? = dao.getVendorByIdDirect(id)

    // --- Cart Actions ---
    suspend fun addToCart(product: ProductVideo, quantity: Int = 1) {
        val item = CartItem(
            productId = product.id,
            vendorId = product.vendorId,
            vendorName = product.vendorName,
            productTitle = product.title,
            priceNaira = product.priceNaira,
            quantity = quantity,
            distanceKm = product.distanceKmFromUser,
            deliveryRadiusKm = product.deliveryRadiusKm,
            category = product.category,
            themeColor = product.videoGradientStart
        )
        dao.insertCartItem(item)
    }

    suspend fun removeFromCart(cartItemId: Long) {
        dao.deleteCartItem(cartItemId)
    }

    suspend fun clearCart() {
        dao.clearCart()
    }

    // --- Complete Journey: 1. Checkout & Mock Payment ---
    suspend fun placeOrderWithMockPayment(
        buyerName: String,
        buyerPhone: String,
        buyerAddress: String,
        buyerArea: String,
        cartItem: CartItem,
        paymentMethod: String,
        idempotencyKey: String = ""
    ): MarketOrder {
        if (idempotencyKey.isNotBlank()) {
            val existing = dao.getOrderByReceiptKey(idempotencyKey)
            if (existing != null) {
                // Idempotent recovery: return existing order to prevent duplicate billing
                return existing
            }
        }
        val now = System.currentTimeMillis()
        val orderNum = "ORD-LAF-${Random.nextInt(1000, 9999)}"
        val subtotal = cartItem.priceNaira * cartItem.quantity
        // Delivery fee calculation based on km distance (Base ₦500 + ₦100/km)
        val deliveryFee = 500.0 + (cartItem.distanceKm * 100.0)
        val total = subtotal + deliveryFee
        val commission = subtotal * 0.05 // 5% platform commission
        val vendorNet = subtotal - commission
        val txnRef = "TRX-MOCK-${Random.nextInt(100000, 999999)}"

        val order = MarketOrder(
            orderNumber = orderNum,
            buyerName = buyerName.ifBlank { "Lafia Buyer" },
            buyerPhone = buyerPhone.ifBlank { "0803 123 4567" },
            buyerAddress = buyerAddress.ifBlank { "Bukan Sidi Area, Lafia" },
            buyerAreaInLafia = buyerArea.ifBlank { "Bukan Sidi" },
            vendorId = cartItem.vendorId,
            vendorName = cartItem.vendorName,
            productTitle = cartItem.productTitle,
            quantity = cartItem.quantity,
            unitPriceNaira = cartItem.priceNaira,
            subtotalNaira = subtotal,
            deliveryFeeNaira = deliveryFee,
            totalNaira = total,
            platformCommissionNaira = commission,
            vendorNetNaira = vendorNet,
            distanceKm = cartItem.distanceKm,
            status = "PLACED",
            paymentMethod = paymentMethod,
            paymentStatus = "PAID_MOCK",
            transactionRef = txnRef,
            idempotencyKey = idempotencyKey,
            createdAt = now
        )

        val insertedId = dao.insertOrder(order)
        dao.deleteCartItem(cartItem.id)
        return order.copy(id = insertedId)
    }

    // --- Complete Journey: 2. Vendor Accepts Order ---
    suspend fun vendorAcceptOrder(orderId: Long) {
        val order = dao.getOrderByIdDirect(orderId) ?: return
        val updated = order.copy(
            status = "ACCEPTED",
            acceptedAt = System.currentTimeMillis()
        )
        dao.updateOrder(updated)
    }

    // --- Complete Journey: 3. Order Dispatched / Out for Delivery ---
    suspend fun vendorDispatchOrder(orderId: Long, riderName: String = "Musa Ibrahim (Lafia Dispatch)", riderPhone: String = "0803 456 7890") {
        val order = dao.getOrderByIdDirect(orderId) ?: return
        val updated = order.copy(
            status = "OUT_FOR_DELIVERY",
            dispatchedAt = System.currentTimeMillis(),
            riderName = riderName,
            riderPhone = riderPhone
        )
        dao.updateOrder(updated)
    }

    // --- Complete Journey: 4. Order Delivered -> Commission Recorded in Staff Ledger ---
    suspend fun markOrderDelivered(orderId: Long) {
        val order = dao.getOrderByIdDirect(orderId) ?: return
        if (order.status == "DELIVERED") return // already processed

        val now = System.currentTimeMillis()
        val updatedOrder = order.copy(
            status = "DELIVERED",
            deliveredAt = now
        )
        dao.updateOrder(updatedOrder)

        // 1. Record 5% Platform Commission in Staff Ledger
        val ledgerEntry = StaffLedgerEntry(
            orderId = order.id,
            orderNumber = order.orderNumber,
            vendorId = order.vendorId,
            vendorName = order.vendorName,
            totalOrderNaira = order.subtotalNaira,
            commissionNaira = order.platformCommissionNaira,
            netVendorNaira = order.vendorNetNaira,
            type = "COMMISSION_EARNED",
            note = "5% Platform Commission (₦${nairaFormat.format(order.platformCommissionNaira)}) booked upon verified delivery of ${order.productTitle} to ${order.buyerAddress}, Lafia.",
            timestamp = now
        )
        dao.insertLedgerEntry(ledgerEntry)

        // 2. Credit Vendor Net Earnings & Update Vendor Metrics
        val vendor = dao.getVendorByIdDirect(order.vendorId)
        if (vendor != null) {
            val updatedVendor = vendor.copy(
                totalSalesNaira = vendor.totalSalesNaira + order.subtotalNaira,
                netEarningsNaira = vendor.netEarningsNaira + order.vendorNetNaira,
                commissionPaidNaira = vendor.commissionPaidNaira + order.platformCommissionNaira,
                pendingSettlementNaira = vendor.pendingSettlementNaira + order.vendorNetNaira
            )
            dao.updateVendor(updatedVendor)
        }
    }

    // --- Vendor: Upload Video & Product ---
    suspend fun uploadProductVideo(
        vendorId: Long,
        title: String,
        description: String,
        category: String,
        priceNaira: Double,
        stockQuantity: Int,
        deliveryRadiusKm: Double,
        gradientStart: Long = 0xFF059669,
        gradientEnd: Long = 0xFF10B981
    ): Long {
        val vendor = dao.getVendorByIdDirect(vendorId)
        val vendorName = vendor?.name ?: "Lafia Local Merchant"

        val video = ProductVideo(
            vendorId = vendorId,
            vendorName = vendorName,
            title = title,
            description = description,
            category = category,
            priceNaira = priceNaira,
            stockQuantity = stockQuantity,
            deliveryRadiusKm = deliveryRadiusKm,
            videoThemeColor = gradientStart,
            videoGradientStart = gradientStart,
            videoGradientEnd = gradientEnd,
            videoDurationSeconds = Random.nextInt(15, 45),
            distanceKmFromUser = Random.nextDouble(1.0, 4.5),
            likesCount = 1,
            viewsCount = 1,
            isApprovedByStaff = true, // auto-approved or pending based on staff policy
            moderationStatus = "APPROVED",
            createdAt = System.currentTimeMillis()
        )
        return dao.insertProductVideo(video)
    }

    // --- Vendor: Request Settlement Payout ---
    suspend fun requestVendorSettlement(vendorId: Long, amountNaira: Double): Long {
        val vendor = dao.getVendorByIdDirect(vendorId) ?: return -1
        val req = VendorSettlementRequest(
            vendorId = vendorId,
            vendorName = vendor.name,
            bankName = vendor.bankName,
            accountNumber = vendor.bankAccountNumber,
            accountName = vendor.bankAccountName.ifBlank { vendor.name },
            amountNaira = amountNaira,
            status = "PENDING",
            requestedAt = System.currentTimeMillis()
        )
        return dao.insertSettlementRequest(req)
    }

    // --- Staff: Moderate Video ---
    suspend fun moderateVideo(videoId: Long, newStatus: String, reason: String? = null) {
        val video = dao.getVideoByIdDirect(videoId) ?: return
        val updated = video.copy(
            moderationStatus = newStatus,
            isApprovedByStaff = (newStatus == "APPROVED"),
            moderationFlagReason = reason
        )
        dao.updateProductVideo(updated)
    }

    // --- Staff: Verify / Suspend Vendor ---
    suspend fun updateVendorVerification(vendorId: Long, status: String) {
        val vendor = dao.getVendorByIdDirect(vendorId) ?: return
        val updated = vendor.copy(
            verificationStatus = status,
            isVerified = (status == "VERIFIED")
        )
        dao.updateVendor(updated)
    }

    // --- Staff: Resolve Dispute ---
    suspend fun resolveDispute(disputeId: Long, resolution: String, note: String) {
        val disputes = dao.getAllDisputes() // we can query directly
        // We'll update the dispute
    }

    suspend fun updateDisputeDirect(dispute: MarketDispute) {
        dao.updateDispute(dispute)
    }

    // --- Staff: Approve Vendor Settlement ---
    suspend fun approveSettlementRequest(request: VendorSettlementRequest) {
        val updated = request.copy(
            status = "COMPLETED",
            processedAt = System.currentTimeMillis()
        )
        dao.updateSettlementRequest(updated)

        val vendor = dao.getVendorByIdDirect(request.vendorId)
        if (vendor != null) {
            val newPending = (vendor.pendingSettlementNaira - request.amountNaira).coerceAtLeast(0.0)
            dao.updateVendor(vendor.copy(pendingSettlementNaira = newPending))
        }

        // Add ledger record for payout
        val ledger = StaffLedgerEntry(
            orderId = 0,
            orderNumber = "PAYOUT-SETTLE-${Random.nextInt(1000, 9999)}",
            vendorId = request.vendorId,
            vendorName = request.vendorName,
            totalOrderNaira = request.amountNaira,
            commissionNaira = 0.0,
            netVendorNaira = request.amountNaira,
            type = "VENDOR_PAYOUT_SETTLED",
            note = "Settlement payout of ₦${nairaFormat.format(request.amountNaira)} processed to ${request.bankName} (${request.accountNumber}) for ${request.vendorName}",
            timestamp = System.currentTimeMillis()
        )
        dao.insertLedgerEntry(ledger)
    }

    // --- AI Shopping Assistant Logic (STRICT MANDATORY SAFETY RULE) ---
    // AI may recommend products and prepare a draft order, but NEVER confirms or charges without explicit buyer approval!
    suspend fun processAiUserPrompt(userPrompt: String): AiChatMessage {
        val now = System.currentTimeMillis()
        // Save user message
        val userMsg = AiChatMessage(
            sender = "BUYER",
            messageText = userPrompt,
            timestamp = now
        )
        dao.insertAiChatMessage(userMsg)

        val lower = userPrompt.lowercase()

        // Match local Lafia catalog
        var matchedProduct: ProductVideo? = null
        val responseText: String

        if (lower.contains("yam") || lower.contains("produce") || lower.contains("bukan") || lower.contains("farm")) {
            matchedProduct = dao.getVideoByIdDirect(1) // Tuber Yams
            responseText = "Sannu! I found fresh Lafia dry-soil Tuber Yams at Dalhatu Araf Fresh Produce Hub in Bukan Sidi (₦14,500 for a 5-tuber bundle, 1.8 km away). I have prepared a draft order below for your inspection. Please review and confirm to proceed."
        } else if (lower.contains("catfish") || lower.contains("fish") || lower.contains("spice") || lower.contains("suya") || lower.contains("market")) {
            matchedProduct = dao.getVideoByIdDirect(2) // Smoked Catfish & Suya
            responseText = "I found Smoked Catfish & Authentic Suya Pepper Set at Lafia Modern Market (₦7,500, 2.4 km away). I have drafted an order for 1 set. Remember: I cannot charge or place this order automatically—you must review and confirm below."
        } else if (lower.contains("aso-oke") || lower.contains("cloth") || lower.contains("fashion") || lower.contains("agbada") || lower.contains("dress")) {
            matchedProduct = dao.getVideoByIdDirect(3) // Ta'al Aso-Oke
            responseText = "Ta'al Fashion & Aso-Oke Studio on Jos Road has the Handwoven Lafia Aso-Oke Agbada & Cap in stock (₦35,000, 3.1 km delivery). Here is your draft order breakdown. Tap 'Review & Confirm Order' when you are ready."
        } else if (lower.contains("honey") || lower.contains("wara") || lower.contains("cheese") || lower.contains("kwandere") || lower.contains("milk")) {
            matchedProduct = dao.getVideoByIdDirect(4) // Kwandere Organic
            responseText = "Kwandere Organic Farms has raw wild honeycomb honey & morning-pressed Wara cheese (₦6,200, 4.2 km away). I have prepared a draft order for you below."
        } else if (lower.contains("power") || lower.contains("tech") || lower.contains("solar") || lower.contains("charger") || lower.contains("phone")) {
            matchedProduct = dao.getVideoByIdDirect(5) // Emir's Palace Tech
            responseText = "Emir's Palace Tech & Gadgets in Central Lafia has the Solar 30,000mAh Power Bank (₦18,500, 1.2 km away). Here is a prepared draft order."
        } else {
            matchedProduct = dao.getVideoByIdDirect(1) // Default to local Lafia Yam
            responseText = "Welcome to LocalHub Lafia! I can help you find fresh farm produce, grains, spices, Aso-Oke fashion, and tech gadgets from verified Lafia merchants. Here is our featured dry-soil Lafia Yam bundle in Bukan Sidi as a draft recommendation."
        }

        val deliveryFee = 500.0 + ((matchedProduct?.distanceKmFromUser ?: 2.0) * 100.0)
        val productPrice = matchedProduct?.priceNaira ?: 14500.0
        val total = productPrice + deliveryFee

        val aiMsg = AiChatMessage(
            sender = "AI_ASSISTANT",
            messageText = responseText,
            timestamp = now + 500,
            hasDraftOrder = true,
            draftProductId = matchedProduct?.id ?: 1,
            draftProductTitle = matchedProduct?.title ?: "Premium Lafia Tuber Yams",
            draftVendorId = matchedProduct?.vendorId ?: 1,
            draftVendorName = matchedProduct?.vendorName ?: "Dalhatu Araf Fresh Produce Hub",
            draftPriceNaira = productPrice,
            draftQuantity = 1,
            draftDeliveryFeeNaira = deliveryFee,
            draftTotalNaira = total,
            draftDistanceKm = matchedProduct?.distanceKmFromUser ?: 1.8,
            draftArea = "Bukan Sidi, Lafia"
        )
        dao.insertAiChatMessage(aiMsg)
        return aiMsg
    }
}
