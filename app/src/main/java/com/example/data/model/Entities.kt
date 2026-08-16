package com.example.data.model

import androidx.room.Entity
import androidx.room.PrimaryKey

@Entity(tableName = "vendors")
data class Vendor(
    @PrimaryKey(autoGenerate = true) val id: Long = 0,
    val name: String,
    val ownerName: String,
    val category: String,
    val address: String,
    val areaInLafia: String,
    val lat: Double = 8.4933,
    val lng: Double = 8.5153,
    val phone: String,
    val email: String,
    val rating: Double = 4.8,
    val reviewCount: Int = 24,
    val isVerified: Boolean = true,
    val verificationStatus: String = "VERIFIED", // "VERIFIED", "PENDING", "SUSPENDED"
    val cacNumber: String = "RC-489102",
    val deliveryRadiusKm: Double = 8.0,
    val totalSalesNaira: Double = 0.0,
    val netEarningsNaira: Double = 0.0,
    val commissionPaidNaira: Double = 0.0,
    val pendingSettlementNaira: Double = 0.0,
    val bankName: String = "Access Bank (Lafia Branch)",
    val bankAccountNumber: String = "0123456789",
    val bankAccountName: String = "",
    val gradientStart: Long = 0xFF10B981,
    val gradientEnd: Long = 0xFF059669
)

@Entity(tableName = "product_videos")
data class ProductVideo(
    @PrimaryKey(autoGenerate = true) val id: Long = 0,
    val vendorId: Long,
    val vendorName: String,
    val title: String,
    val description: String,
    val category: String, // "Fresh Produce", "Grains & Tubers", "Fashion & Aso-Oke", "Tech & Gadgets", "Fish & Agro", "Herbs & Spices"
    val priceNaira: Double,
    val stockQuantity: Int,
    val deliveryRadiusKm: Double = 6.0,
    val videoThemeColor: Long = 0xFF1E293B,
    val videoGradientStart: Long = 0xFF047857,
    val videoGradientEnd: Long = 0xFF065F46,
    val videoDurationSeconds: Int = 24,
    val distanceKmFromUser: Double = 1.8,
    val likesCount: Int = 142,
    val viewsCount: Int = 890,
    val isApprovedByStaff: Boolean = true,
    val moderationStatus: String = "APPROVED", // "APPROVED", "PENDING", "FLAGGED"
    val moderationFlagReason: String? = null,
    val createdAt: Long = System.currentTimeMillis(),
    val isPromoted: Boolean = false
)

@Entity(tableName = "cart_items")
data class CartItem(
    @PrimaryKey(autoGenerate = true) val id: Long = 0,
    val productId: Long,
    val vendorId: Long,
    val vendorName: String,
    val productTitle: String,
    val priceNaira: Double,
    val quantity: Int = 1,
    val distanceKm: Double = 2.0,
    val deliveryRadiusKm: Double = 8.0,
    val category: String = "Produce",
    val themeColor: Long = 0xFF10B981
)

@Entity(tableName = "market_orders")
data class MarketOrder(
    @PrimaryKey(autoGenerate = true) val id: Long = 0,
    val orderNumber: String,
    val buyerName: String,
    val buyerPhone: String,
    val buyerAddress: String,
    val buyerAreaInLafia: String,
    val vendorId: Long,
    val vendorName: String,
    val productTitle: String,
    val quantity: Int,
    val unitPriceNaira: Double,
    val subtotalNaira: Double,
    val deliveryFeeNaira: Double,
    val totalNaira: Double,
    val platformCommissionNaira: Double, // 5% of subtotal
    val vendorNetNaira: Double, // subtotal - commission
    val distanceKm: Double,
    val status: String = "PLACED", // "PLACED", "ACCEPTED", "OUT_FOR_DELIVERY", "DELIVERED", "CANCELLED"
    val paymentMethod: String = "Mock Bank Transfer", // "Mock Bank Transfer", "Mock Debit Card", "Mock USSD"
    val paymentStatus: String = "PAID_MOCK",
    val transactionRef: String,
    val idempotencyKey: String = "",
    val createdAt: Long = System.currentTimeMillis(),
    val acceptedAt: Long? = null,
    val dispatchedAt: Long? = null,
    val deliveredAt: Long? = null,
    val riderName: String = "Musa Ibrahim (Lafia Express Dispatch)",
    val riderPhone: String = "0803 456 7890"
)

@Entity(tableName = "staff_ledger_entries")
data class StaffLedgerEntry(
    @PrimaryKey(autoGenerate = true) val id: Long = 0,
    val orderId: Long,
    val orderNumber: String,
    val vendorId: Long,
    val vendorName: String,
    val totalOrderNaira: Double,
    val commissionNaira: Double, // 5%
    val netVendorNaira: Double,
    val type: String = "COMMISSION_EARNED", // "COMMISSION_EARNED", "VENDOR_PAYOUT_SETTLED"
    val note: String,
    val timestamp: Long = System.currentTimeMillis()
)

@Entity(tableName = "vendor_settlement_requests")
data class VendorSettlementRequest(
    @PrimaryKey(autoGenerate = true) val id: Long = 0,
    val vendorId: Long,
    val vendorName: String,
    val bankName: String,
    val accountNumber: String,
    val accountName: String,
    val amountNaira: Double,
    val status: String = "PENDING", // "PENDING", "APPROVED", "COMPLETED"
    val requestedAt: Long = System.currentTimeMillis(),
    val processedAt: Long? = null
)

@Entity(tableName = "market_disputes")
data class MarketDispute(
    @PrimaryKey(autoGenerate = true) val id: Long = 0,
    val orderId: Long,
    val orderNumber: String,
    val buyerName: String,
    val vendorName: String,
    val issueCategory: String, // "Quality Concern", "Delivery Delay", "Wrong Item", "Missing Item"
    val issueDescription: String,
    val amountNaira: Double,
    val status: String = "OPEN", // "OPEN", "RESOLVED_REFUND", "RESOLVED_PAYOUT"
    val createdAt: Long = System.currentTimeMillis(),
    val resolutionNote: String? = null
)

@Entity(tableName = "ai_chat_messages")
data class AiChatMessage(
    @PrimaryKey(autoGenerate = true) val id: Long = 0,
    val sender: String, // "BUYER", "AI_ASSISTANT"
    val messageText: String,
    val timestamp: Long = System.currentTimeMillis(),
    val hasDraftOrder: Boolean = false,
    val draftProductId: Long? = null,
    val draftProductTitle: String? = null,
    val draftVendorId: Long? = null,
    val draftVendorName: String? = null,
    val draftPriceNaira: Double? = null,
    val draftQuantity: Int = 1,
    val draftDeliveryFeeNaira: Double? = null,
    val draftTotalNaira: Double? = null,
    val draftDistanceKm: Double? = null,
    val draftArea: String? = null,
    val isDraftApprovedByUser: Boolean = false
)

@Entity(tableName = "product_reviews")
data class ProductReview(
    @PrimaryKey(autoGenerate = true) val id: Long = 0,
    val vendorId: Long,
    val productId: Long,
    val authorName: String,
    val rating: Int,
    val comment: String,
    val timestamp: Long = System.currentTimeMillis()
)
