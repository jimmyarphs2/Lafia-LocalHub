package com.example.data

import android.content.Context
import androidx.room.Database
import androidx.room.Room
import androidx.room.RoomDatabase
import androidx.room.migration.Migration
import androidx.sqlite.db.SupportSQLiteDatabase
import com.example.data.dao.LocalHubDao
import com.example.data.model.AiChatMessage
import com.example.data.model.CartItem
import com.example.data.model.MarketDispute
import com.example.data.model.MarketOrder
import com.example.data.model.ProductReview
import com.example.data.model.ProductVideo
import com.example.data.model.StaffLedgerEntry
import com.example.data.model.Vendor
import com.example.data.model.VendorSettlementRequest
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch

@Database(
    entities = [
        Vendor::class,
        ProductVideo::class,
        CartItem::class,
        MarketOrder::class,
        StaffLedgerEntry::class,
        VendorSettlementRequest::class,
        MarketDispute::class,
        AiChatMessage::class,
        ProductReview::class
    ],
    version = 2,
    exportSchema = false
)
abstract class AppDatabase : RoomDatabase() {
    abstract fun localHubDao(): LocalHubDao

    companion object {
        @Volatile
        private var INSTANCE: AppDatabase? = null

        val MIGRATION_1_2 = object : Migration(1, 2) {
            override fun migrate(db: SupportSQLiteDatabase) {
                db.execSQL("ALTER TABLE market_orders ADD COLUMN idempotencyKey TEXT NOT NULL DEFAULT ''")
            }
        }

        fun getDatabase(context: Context, scope: CoroutineScope): AppDatabase {
            return INSTANCE ?: synchronized(this) {
                val instance = Room.databaseBuilder(
                    context.applicationContext,
                    AppDatabase::class.java,
                    "localhub_lafia_database.db"
                )
                    .addMigrations(MIGRATION_1_2)
                    .addCallback(DatabaseCallback(scope))
                    .fallbackToDestructiveMigration(dropAllTables = true)
                    .build()
                INSTANCE = instance
                instance
            }
        }

        private class DatabaseCallback(
            private val scope: CoroutineScope
        ) : RoomDatabase.Callback() {
            override fun onCreate(db: SupportSQLiteDatabase) {
                super.onCreate(db)
                INSTANCE?.let { database ->
                    scope.launch(Dispatchers.IO) {
                        seedDatabase(database.localHubDao())
                    }
                }
            }
        }

        private suspend fun seedDatabase(dao: LocalHubDao) {
            val now = System.currentTimeMillis()
            val day = 86400000L
            val hour = 3600000L

            // 1. Realistic Lafia Vendors
            val vendors = listOf(
                Vendor(
                    id = 1,
                    name = "Dalhatu Araf Fresh Produce Hub",
                    ownerName = "Alhaji Haruna Dalhatu",
                    category = "Grains & Tubers",
                    address = "Plot 14, Bukan Sidi Express Way, Lafia",
                    areaInLafia = "Bukan Sidi",
                    lat = 8.4980,
                    lng = 8.5140,
                    phone = "0803 214 8899",
                    email = "orders@dalhatuproduce.ng",
                    rating = 4.9,
                    reviewCount = 38,
                    isVerified = true,
                    verificationStatus = "VERIFIED",
                    cacNumber = "BN-349812",
                    deliveryRadiusKm = 12.0,
                    totalSalesNaira = 145000.0,
                    netEarningsNaira = 137750.0,
                    commissionPaidNaira = 7250.0,
                    pendingSettlementNaira = 45000.0,
                    bankName = "First Bank of Nigeria (Lafia Branch)",
                    bankAccountNumber = "3098124501",
                    bankAccountName = "Dalhatu Araf Agro Ventures",
                    gradientStart = 0xFF059669,
                    gradientEnd = 0xFF10B981
                ),
                Vendor(
                    id = 2,
                    name = "Lafia Modern Market Spices & Grains",
                    ownerName = "Hajiya Maryam Al-Hassan",
                    category = "Herbs & Spices",
                    address = "Block C, Stall 22-24, Modern Market, Lafia",
                    areaInLafia = "Modern Market",
                    lat = 8.4921,
                    lng = 8.5178,
                    phone = "0814 990 1234",
                    email = "spices@lafiamodernmarket.ng",
                    rating = 4.8,
                    reviewCount = 52,
                    isVerified = true,
                    verificationStatus = "VERIFIED",
                    cacNumber = "BN-781203",
                    deliveryRadiusKm = 10.0,
                    totalSalesNaira = 92000.0,
                    netEarningsNaira = 87400.0,
                    commissionPaidNaira = 4600.0,
                    pendingSettlementNaira = 28000.0,
                    bankName = "Access Bank (Lafia Jos Road)",
                    bankAccountNumber = "0087192345",
                    bankAccountName = "Maryam Al-Hassan Spices",
                    gradientStart = 0xFFD97706,
                    gradientEnd = 0xFFF59E0B
                ),
                Vendor(
                    id = 3,
                    name = "Ta'al Fashion & Aso-Oke Studio",
                    ownerName = "Umar Tanko Al-Makura",
                    category = "Fashion & Aso-Oke",
                    address = "18 Jos Road, Opposite City Gate, Lafia",
                    areaInLafia = "Jos Road",
                    lat = 8.5020,
                    lng = 8.5200,
                    phone = "0802 884 1002",
                    email = "couture@taalfashion.ng",
                    rating = 5.0,
                    reviewCount = 41,
                    isVerified = true,
                    verificationStatus = "VERIFIED",
                    cacNumber = "RC-990145",
                    deliveryRadiusKm = 15.0,
                    totalSalesNaira = 280000.0,
                    netEarningsNaira = 266000.0,
                    commissionPaidNaira = 14000.0,
                    pendingSettlementNaira = 95000.0,
                    bankName = "Guaranty Trust Bank (GTB Lafia)",
                    bankAccountNumber = "0142998311",
                    bankAccountName = "Taal Couture & Textile Ltd",
                    gradientStart = 0xFF7C3AED,
                    gradientEnd = 0xFF8B5CF6
                ),
                Vendor(
                    id = 4,
                    name = "Emir's Palace Tech & Gadgets",
                    ownerName = "Victor Chukwuemeka",
                    category = "Tech & Gadgets",
                    address = "7 Emir's Palace Way, Central Lafia",
                    areaInLafia = "Emir's Palace",
                    lat = 8.4900,
                    lng = 8.5130,
                    phone = "0818 776 5432",
                    email = "sales@emirpalacetech.ng",
                    rating = 4.7,
                    reviewCount = 29,
                    isVerified = true,
                    verificationStatus = "VERIFIED",
                    cacNumber = "BN-561290",
                    deliveryRadiusKm = 8.0,
                    totalSalesNaira = 210000.0,
                    netEarningsNaira = 199500.0,
                    commissionPaidNaira = 10500.0,
                    pendingSettlementNaira = 65000.0,
                    bankName = "Zenith Bank (Lafia Commercial Area)",
                    bankAccountNumber = "2081190023",
                    bankAccountName = "Emir Palace Tech Store",
                    gradientStart = 0xFF2563EB,
                    gradientEnd = 0xFF3B82F6
                ),
                Vendor(
                    id = 5,
                    name = "Kwandere Organic Farms & Dairy",
                    ownerName = "Balarabe Kwandere",
                    category = "Fresh Produce",
                    address = "Km 3 Kwandere Road, Nasarawa LGA Border",
                    areaInLafia = "Kwandere",
                    lat = 8.5150,
                    lng = 8.5080,
                    phone = "0806 554 9911",
                    email = "farm@kwandereorganic.ng",
                    rating = 4.9,
                    reviewCount = 64,
                    isVerified = true,
                    verificationStatus = "VERIFIED",
                    cacNumber = "BN-882341",
                    deliveryRadiusKm = 14.0,
                    totalSalesNaira = 175000.0,
                    netEarningsNaira = 166250.0,
                    commissionPaidNaira = 8750.0,
                    pendingSettlementNaira = 52000.0,
                    bankName = "United Bank for Africa (UBA Lafia)",
                    bankAccountNumber = "2109845123",
                    bankAccountName = "Kwandere Agro Allied Enterprise",
                    gradientStart = 0xFF059669,
                    gradientEnd = 0xFF34D399
                ),
                Vendor(
                    id = 6,
                    name = "College of Ag Fish & Agro Hub",
                    ownerName = "Dr. Amina Audu",
                    category = "Fish & Agro",
                    address = "College of Agriculture Gate Road, Lafia",
                    areaInLafia = "College of Agriculture",
                    lat = 8.4850,
                    lng = 8.5250,
                    phone = "0807 332 1199",
                    email = "fishery@coagrolafia.edu.ng",
                    rating = 4.8,
                    reviewCount = 31,
                    isVerified = false,
                    verificationStatus = "PENDING", // Ready for Staff Verification Demo!
                    cacNumber = "BN-991204",
                    deliveryRadiusKm = 10.0,
                    totalSalesNaira = 0.0,
                    netEarningsNaira = 0.0,
                    commissionPaidNaira = 0.0,
                    pendingSettlementNaira = 0.0,
                    bankName = "Kuda Microfinance Bank",
                    bankAccountNumber = "1109983421",
                    bankAccountName = "College Agro Hatchery",
                    gradientStart = 0xFF0891B2,
                    gradientEnd = 0xFF06B6D4
                )
            )
            dao.insertVendors(vendors)

            // 2. Realistic Product Videos showcasing Lafia goods
            val productVideos = listOf(
                ProductVideo(
                    id = 1,
                    vendorId = 1,
                    vendorName = "Dalhatu Araf Fresh Produce Hub",
                    title = "Premium Lafia Tuber Yams (Bundle of 5 Large Tubers)",
                    description = "Freshly harvested sweet dry-soil yams directly from farm clusters in Lafia. Pounded yam texture guaranteed smooth and fluffy. Free inspection on delivery.",
                    category = "Grains & Tubers",
                    priceNaira = 14500.0,
                    stockQuantity = 45,
                    deliveryRadiusKm = 12.0,
                    videoThemeColor = 0xFF78350F,
                    videoGradientStart = 0xFF92400E,
                    videoGradientEnd = 0xFFD97706,
                    videoDurationSeconds = 28,
                    distanceKmFromUser = 1.8,
                    likesCount = 312,
                    viewsCount = 1480,
                    isApprovedByStaff = true,
                    moderationStatus = "APPROVED",
                    isPromoted = true,
                    createdAt = now - 2 * hour
                ),
                ProductVideo(
                    id = 2,
                    vendorId = 2,
                    vendorName = "Lafia Modern Market Spices & Grains",
                    title = "Smoked Catfish & Authentic Suya Pepper Set",
                    description = "Sun-dried kiln-smoked freshwater catfish with authentic Nasarawa suya spice blend, fermented locust beans (Iru), and crushed chili.",
                    category = "Herbs & Spices",
                    priceNaira = 7500.0,
                    stockQuantity = 30,
                    deliveryRadiusKm = 10.0,
                    videoThemeColor = 0xFF991B1B,
                    videoGradientStart = 0xFFB91C1C,
                    videoGradientEnd = 0xFFEA580C,
                    videoDurationSeconds = 22,
                    distanceKmFromUser = 2.4,
                    likesCount = 189,
                    viewsCount = 920,
                    isApprovedByStaff = true,
                    moderationStatus = "APPROVED",
                    isPromoted = false,
                    createdAt = now - 5 * hour
                ),
                ProductVideo(
                    id = 3,
                    vendorId = 3,
                    vendorName = "Ta'al Fashion & Aso-Oke Studio",
                    title = "Handwoven Lafia Aso-Oke Agbada & Cap",
                    description = "Exquisite 3-piece handwoven Aso-Oke ceremonial wear with royal gold embroidery. Custom tailored in our Jos Road workshop. Immediate delivery in Lafia.",
                    category = "Fashion & Aso-Oke",
                    priceNaira = 35000.0,
                    stockQuantity = 12,
                    deliveryRadiusKm = 15.0,
                    videoThemeColor = 0xFF581C87,
                    videoGradientStart = 0xFF6D28D9,
                    videoGradientEnd = 0xFF8B5CF6,
                    videoDurationSeconds = 35,
                    distanceKmFromUser = 3.1,
                    likesCount = 450,
                    viewsCount = 2300,
                    isApprovedByStaff = true,
                    moderationStatus = "APPROVED",
                    isPromoted = true,
                    createdAt = now - 1 * day
                ),
                ProductVideo(
                    id = 4,
                    vendorId = 5,
                    vendorName = "Kwandere Organic Farms & Dairy",
                    title = "Fresh Organic Honey & Farm-Pressed Wara (Cheese)",
                    description = "1-Litre raw unfiltered honeycomb honey and a box of fresh morning-pressed local Wara cheese from Kwandere grazing fields.",
                    category = "Fresh Produce",
                    priceNaira = 6200.0,
                    stockQuantity = 25,
                    deliveryRadiusKm = 14.0,
                    videoThemeColor = 0xFF14532D,
                    videoGradientStart = 0xFF15803D,
                    videoGradientEnd = 0xFF22C55E,
                    videoDurationSeconds = 19,
                    distanceKmFromUser = 4.2,
                    likesCount = 265,
                    viewsCount = 1150,
                    isApprovedByStaff = true,
                    moderationStatus = "APPROVED",
                    isPromoted = false,
                    createdAt = now - 12 * hour
                ),
                ProductVideo(
                    id = 5,
                    vendorId = 4,
                    vendorName = "Emir's Palace Tech & Gadgets",
                    title = "Solar 30,000mAh Power Bank with Fast QC 3.0",
                    description = "Heavy-duty outdoor solar rechargeable power bank with dual LED torch and high-speed fast charging for all Android & iPhone devices.",
                    category = "Tech & Gadgets",
                    priceNaira = 18500.0,
                    stockQuantity = 18,
                    deliveryRadiusKm = 8.0,
                    videoThemeColor = 0xFF1E3A8A,
                    videoGradientStart = 0xFF1D4ED8,
                    videoGradientEnd = 0xFF3B82F6,
                    videoDurationSeconds = 25,
                    distanceKmFromUser = 1.2,
                    likesCount = 380,
                    viewsCount = 1750,
                    isApprovedByStaff = true,
                    moderationStatus = "APPROVED",
                    isPromoted = false,
                    createdAt = now - 18 * hour
                ),
                ProductVideo(
                    id = 6,
                    vendorId = 1,
                    vendorName = "Dalhatu Araf Fresh Produce Hub",
                    title = "50kg Bag of Pure White Garri (Ijebu Grain Texture)",
                    description = "Crisp, stone-free dried cassava flakes processed with hygienic hydraulic pressing in Bukan Sidi. Ideal for soaking and making eba.",
                    category = "Grains & Tubers",
                    priceNaira = 26000.0,
                    stockQuantity = 20,
                    deliveryRadiusKm = 12.0,
                    videoThemeColor = 0xFF854D0E,
                    videoGradientStart = 0xFFA16207,
                    videoGradientEnd = 0xFFEAB308,
                    videoDurationSeconds = 24,
                    distanceKmFromUser = 1.8,
                    likesCount = 210,
                    viewsCount = 890,
                    isApprovedByStaff = true,
                    moderationStatus = "APPROVED",
                    isPromoted = false,
                    createdAt = now - 3 * day
                ),
                ProductVideo(
                    id = 7,
                    vendorId = 6,
                    vendorName = "College of Ag Fish & Agro Hub",
                    title = "Live Table-Size Catfish (10-Fish Basin)",
                    description = "Freshly scooped table-size live African catfish grown in aerated freshwater earthen ponds at College of Agriculture Lafia.",
                    category = "Fish & Agro",
                    priceNaira = 16000.0,
                    stockQuantity = 15,
                    deliveryRadiusKm = 10.0,
                    videoThemeColor = 0xFF164E63,
                    videoGradientStart = 0xFF0E7490,
                    videoGradientEnd = 0xFF06B6D4,
                    videoDurationSeconds = 20,
                    distanceKmFromUser = 5.0,
                    likesCount = 95,
                    viewsCount = 410,
                    isApprovedByStaff = false,
                    moderationStatus = "PENDING", // Ready for Staff Video Moderation queue!
                    isPromoted = false,
                    createdAt = now - 30 * 60000
                )
            )
            dao.insertProductVideos(productVideos)

            // 3. Initial Orders demonstrating lifecycle & commission
            val orders = listOf(
                MarketOrder(
                    id = 1,
                    orderNumber = "ORD-LAF-8821",
                    buyerName = "Fatima Shehu",
                    buyerPhone = "0803 112 4455",
                    buyerAddress = "House 12, Doma Road Crescent",
                    buyerAreaInLafia = "Doma Road",
                    vendorId = 1,
                    vendorName = "Dalhatu Araf Fresh Produce Hub",
                    productTitle = "Premium Lafia Tuber Yams (Bundle of 5 Large Tubers)",
                    quantity = 1,
                    unitPriceNaira = 14500.0,
                    subtotalNaira = 14500.0,
                    deliveryFeeNaira = 750.0,
                    totalNaira = 15250.0,
                    platformCommissionNaira = 725.0, // 5% of 14,500
                    vendorNetNaira = 13775.0,
                    distanceKm = 2.8,
                    status = "DELIVERED",
                    paymentMethod = "Mock Bank Transfer",
                    paymentStatus = "PAID_MOCK",
                    transactionRef = "TRX-MOCK-990142",
                    createdAt = now - 1 * day,
                    acceptedAt = now - 23 * hour,
                    dispatchedAt = now - 22 * hour,
                    deliveredAt = now - 21 * hour,
                    riderName = "Musa Ibrahim (Lafia Express)",
                    riderPhone = "0803 456 7890"
                ),
                MarketOrder(
                    id = 2,
                    orderNumber = "ORD-LAF-9412",
                    buyerName = "Emmanuel Onoja",
                    buyerPhone = "0814 778 9900",
                    buyerAddress = "Suite 4, Bukan Sidi Shopping Complex",
                    buyerAreaInLafia = "Bukan Sidi",
                    vendorId = 3,
                    vendorName = "Ta'al Fashion & Aso-Oke Studio",
                    productTitle = "Handwoven Lafia Aso-Oke Agbada & Cap",
                    quantity = 1,
                    unitPriceNaira = 35000.0,
                    subtotalNaira = 35000.0,
                    deliveryFeeNaira = 1000.0,
                    totalNaira = 36000.0,
                    platformCommissionNaira = 1750.0, // 5% of 35,000
                    vendorNetNaira = 33250.0,
                    distanceKm = 3.4,
                    status = "OUT_FOR_DELIVERY",
                    paymentMethod = "Mock Debit Card",
                    paymentStatus = "PAID_MOCK",
                    transactionRef = "TRX-MOCK-771239",
                    createdAt = now - 3 * hour,
                    acceptedAt = now - 2 * hour,
                    dispatchedAt = now - 45 * 60000,
                    riderName = "Audu Yakubu (Lafia Dispatch)",
                    riderPhone = "0805 119 2233"
                ),
                MarketOrder(
                    id = 3,
                    orderNumber = "ORD-LAF-9850",
                    buyerName = "Zainab Bello",
                    buyerPhone = "0802 334 5566",
                    buyerAddress = "15 Jos Road, Near Police Headquarters",
                    buyerAreaInLafia = "Jos Road",
                    vendorId = 2,
                    vendorName = "Lafia Modern Market Spices & Grains",
                    productTitle = "Smoked Catfish & Authentic Suya Pepper Set",
                    quantity = 2,
                    unitPriceNaira = 7500.0,
                    subtotalNaira = 15000.0,
                    deliveryFeeNaira = 600.0,
                    totalNaira = 15600.0,
                    platformCommissionNaira = 750.0, // 5% of 15,000
                    vendorNetNaira = 14250.0,
                    distanceKm = 1.9,
                    status = "PLACED", // Vendor can accept
                    paymentMethod = "Mock USSD (*737#)",
                    paymentStatus = "PAID_MOCK",
                    transactionRef = "TRX-MOCK-665120",
                    createdAt = now - 15 * 60000
                )
            )
            dao.insertOrders(orders)

            // 4. Staff Commission Ledger
            val ledgerEntries = listOf(
                StaffLedgerEntry(
                    id = 1,
                    orderId = 1,
                    orderNumber = "ORD-LAF-8821",
                    vendorId = 1,
                    vendorName = "Dalhatu Araf Fresh Produce Hub",
                    totalOrderNaira = 14500.0,
                    commissionNaira = 725.0, // 5%
                    netVendorNaira = 13775.0,
                    type = "COMMISSION_EARNED",
                    note = "5% Platform Commission collected upon verified delivery of Tuber Yams in Doma Road, Lafia",
                    timestamp = now - 21 * hour
                )
            )
            dao.insertLedgerEntries(ledgerEntries)

            // 5. Vendor Settlement Requests
            val settlements = listOf(
                VendorSettlementRequest(
                    id = 1,
                    vendorId = 1,
                    vendorName = "Dalhatu Araf Fresh Produce Hub",
                    bankName = "First Bank of Nigeria",
                    accountNumber = "3098124501",
                    accountName = "Dalhatu Araf Agro Ventures",
                    amountNaira = 45000.0,
                    status = "PENDING",
                    requestedAt = now - 4 * hour
                )
            )
            for (s in settlements) {
                dao.insertSettlementRequest(s)
            }

            // 6. Market Disputes
            val disputes = listOf(
                MarketDispute(
                    id = 1,
                    orderId = 1,
                    orderNumber = "ORD-LAF-8821",
                    buyerName = "Fatima Shehu",
                    vendorName = "Dalhatu Araf Fresh Produce Hub",
                    issueCategory = "Quality Concern",
                    issueDescription = "Customer requested to verify yam sizes compared to sample video. Vendor clarified harvest grade and provided extra sweet potato tuber as goodwill.",
                    amountNaira = 14500.0,
                    status = "RESOLVED_PAYOUT",
                    createdAt = now - 20 * hour,
                    resolutionNote = "Mutual agreement reached. Quality verified by Lafia dispatch rider. Commission and vendor payout approved."
                )
            )
            dao.insertDisputes(disputes)

            // 7. Initial AI Assistant Chat history demonstrating safety rule
            val chatMessages = listOf(
                AiChatMessage(
                    id = 1,
                    sender = "BUYER",
                    messageText = "Hello! What are the freshest farm produce items available near Bukan Sidi, Lafia today?",
                    timestamp = now - 30 * 60000
                ),
                AiChatMessage(
                    id = 2,
                    sender = "AI_ASSISTANT",
                    messageText = "Sannu! In Bukan Sidi, Alhaji Dalhatu just listed fresh bundles of large Lafia dry-soil Tuber Yams (₦14,500 for 5 tubers, only 1.8 km away). I can prepare a draft order for you to review whenever you are ready!",
                    timestamp = now - 29 * 60000,
                    hasDraftOrder = true,
                    draftProductId = 1,
                    draftProductTitle = "Premium Lafia Tuber Yams (Bundle of 5 Large Tubers)",
                    draftVendorId = 1,
                    draftVendorName = "Dalhatu Araf Fresh Produce Hub",
                    draftPriceNaira = 14500.0,
                    draftQuantity = 1,
                    draftDeliveryFeeNaira = 750.0,
                    draftTotalNaira = 15250.0,
                    draftDistanceKm = 1.8,
                    draftArea = "Bukan Sidi, Lafia"
                )
            )
            dao.insertAiChatMessages(chatMessages)

            // 8. Reviews
            val reviews = listOf(
                ProductReview(
                    id = 1,
                    vendorId = 1,
                    productId = 1,
                    authorName = "Ibrahim Danladi",
                    rating = 5,
                    comment = "Superb yam tubers! Pounded yam came out white and smooth. Delivered in under 35 minutes in Lafia.",
                    timestamp = now - 2 * day
                ),
                ProductReview(
                    id = 2,
                    vendorId = 3,
                    productId = 3,
                    authorName = "Hon. Solomon",
                    rating = 5,
                    comment = "The Aso-Oke embroidery is top notch. Royal finish for my nephew's wedding ceremony.",
                    timestamp = now - 4 * day
                )
            )
            dao.insertReviews(reviews)
        }
    }
}
