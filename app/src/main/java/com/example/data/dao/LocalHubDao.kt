package com.example.data.dao

import androidx.room.Dao
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.Query
import androidx.room.Update
import com.example.data.model.AiChatMessage
import com.example.data.model.CartItem
import com.example.data.model.MarketDispute
import com.example.data.model.MarketOrder
import com.example.data.model.ProductReview
import com.example.data.model.ProductVideo
import com.example.data.model.StaffLedgerEntry
import com.example.data.model.Vendor
import com.example.data.model.VendorSettlementRequest
import kotlinx.coroutines.flow.Flow

@Dao
interface LocalHubDao {

    // --- Vendors ---
    @Query("SELECT * FROM vendors ORDER BY isVerified DESC, rating DESC")
    fun getAllVendors(): Flow<List<Vendor>>

    @Query("SELECT * FROM vendors WHERE id = :id")
    fun getVendorById(id: Long): Flow<Vendor?>

    @Query("SELECT * FROM vendors WHERE id = :id")
    suspend fun getVendorByIdDirect(id: Long): Vendor?

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insertVendors(vendors: List<Vendor>)

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insertVendor(vendor: Vendor): Long

    @Update
    suspend fun updateVendor(vendor: Vendor)

    // --- Product Videos ---
    @Query("SELECT * FROM product_videos WHERE moderationStatus = 'APPROVED' ORDER BY isPromoted DESC, createdAt DESC")
    fun getApprovedProductVideos(): Flow<List<ProductVideo>>

    @Query("SELECT * FROM product_videos ORDER BY createdAt DESC")
    fun getAllProductVideosForModeration(): Flow<List<ProductVideo>>

    @Query("SELECT * FROM product_videos WHERE vendorId = :vendorId ORDER BY createdAt DESC")
    fun getVideosForVendor(vendorId: Long): Flow<List<ProductVideo>>

    @Query("SELECT * FROM product_videos WHERE id = :id")
    fun getVideoById(id: Long): Flow<ProductVideo?>

    @Query("SELECT * FROM product_videos WHERE id = :id")
    suspend fun getVideoByIdDirect(id: Long): ProductVideo?

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insertProductVideos(videos: List<ProductVideo>)

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insertProductVideo(video: ProductVideo): Long

    @Update
    suspend fun updateProductVideo(video: ProductVideo)

    @Query("DELETE FROM product_videos WHERE id = :id")
    suspend fun deleteProductVideo(id: Long)

    // --- Cart Items ---
    @Query("SELECT * FROM cart_items")
    fun getAllCartItems(): Flow<List<CartItem>>

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insertCartItem(item: CartItem): Long

    @Update
    suspend fun updateCartItem(item: CartItem)

    @Query("DELETE FROM cart_items WHERE id = :id")
    suspend fun deleteCartItem(id: Long)

    @Query("DELETE FROM cart_items")
    suspend fun clearCart()

    // --- Market Orders ---
    @Query("SELECT * FROM market_orders ORDER BY createdAt DESC")
    fun getAllOrders(): Flow<List<MarketOrder>>

    @Query("SELECT * FROM market_orders WHERE vendorId = :vendorId ORDER BY createdAt DESC")
    fun getOrdersForVendor(vendorId: Long): Flow<List<MarketOrder>>

    @Query("SELECT * FROM market_orders WHERE id = :id")
    fun getOrderById(id: Long): Flow<MarketOrder?>

    @Query("SELECT * FROM market_orders WHERE id = :id")
    suspend fun getOrderByIdDirect(id: Long): MarketOrder?

    @Query("SELECT * FROM market_orders WHERE orderNumber = :orderNumber")
    suspend fun getOrderByNumber(orderNumber: String): MarketOrder?

    @Query("SELECT * FROM market_orders WHERE idempotencyKey = :key LIMIT 1")
    suspend fun getOrderByReceiptKey(key: String): MarketOrder?

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insertOrders(orders: List<MarketOrder>)

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insertOrder(order: MarketOrder): Long

    @Update
    suspend fun updateOrder(order: MarketOrder)

    // --- Staff Commission Ledger ---
    @Query("SELECT * FROM staff_ledger_entries ORDER BY timestamp DESC")
    fun getAllLedgerEntries(): Flow<List<StaffLedgerEntry>>

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insertLedgerEntry(entry: StaffLedgerEntry): Long

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insertLedgerEntries(entries: List<StaffLedgerEntry>)

    // --- Vendor Settlement Requests ---
    @Query("SELECT * FROM vendor_settlement_requests ORDER BY requestedAt DESC")
    fun getAllSettlementRequests(): Flow<List<VendorSettlementRequest>>

    @Query("SELECT * FROM vendor_settlement_requests WHERE vendorId = :vendorId ORDER BY requestedAt DESC")
    fun getSettlementsForVendor(vendorId: Long): Flow<List<VendorSettlementRequest>>

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insertSettlementRequest(request: VendorSettlementRequest): Long

    @Update
    suspend fun updateSettlementRequest(request: VendorSettlementRequest)

    // --- Disputes ---
    @Query("SELECT * FROM market_disputes ORDER BY createdAt DESC")
    fun getAllDisputes(): Flow<List<MarketDispute>>

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insertDispute(dispute: MarketDispute): Long

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insertDisputes(disputes: List<MarketDispute>)

    @Update
    suspend fun updateDispute(dispute: MarketDispute)

    // --- AI Chat ---
    @Query("SELECT * FROM ai_chat_messages ORDER BY timestamp ASC")
    fun getAllAiChatMessages(): Flow<List<AiChatMessage>>

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insertAiChatMessage(msg: AiChatMessage): Long

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insertAiChatMessages(msgs: List<AiChatMessage>)

    @Update
    suspend fun updateAiChatMessage(msg: AiChatMessage)

    // --- Reviews ---
    @Query("SELECT * FROM product_reviews WHERE vendorId = :vendorId ORDER BY timestamp DESC")
    fun getReviewsForVendor(vendorId: Long): Flow<List<ProductReview>>

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insertReview(review: ProductReview): Long

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insertReviews(reviews: List<ProductReview>)
}
