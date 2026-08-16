package com.example.ui.screens

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material.icons.outlined.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.window.Dialog
import com.example.data.model.MarketOrder
import com.example.data.model.ProductVideo
import com.example.data.model.Vendor
import java.text.DecimalFormat
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun VendorDashboardScreen(
    currentVendor: Vendor?,
    allVendors: List<Vendor>,
    vendorVideos: List<ProductVideo>,
    vendorOrders: List<MarketOrder>,
    onSelectVendor: (Long) -> Unit,
    onUploadVideo: (title: String, desc: String, category: String, price: Double, stock: Int, radiusKm: Double) -> Unit,
    onRequestSettlement: (Double) -> Unit,
    onAcceptOrder: (Long) -> Unit,
    onDispatchOrder: (Long) -> Unit,
    onMarkDelivered: (Long) -> Unit
) {
    val nairaFormat = remember { DecimalFormat("#,##0") }
    var selectedVendorTab by remember { mutableStateOf(0) } // 0: Orders Fulfillment, 1: Product Videos, 2: Earnings & Payouts
    var showUploadModal by remember { mutableStateOf(false) }
    var showPayoutModal by remember { mutableStateOf(false) }

    Column(
        modifier = Modifier
            .fillMaxSize()
            .testTag("vendor_dashboard_screen")
    ) {
        // Vendor Header & Switcher
        Surface(
            modifier = Modifier.fillMaxWidth(),
            color = MaterialTheme.colorScheme.surface,
            tonalElevation = 2.dp
        ) {
            Column(modifier = Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Column(modifier = Modifier.weight(1f)) {
                        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                            Text(
                                text = currentVendor?.name ?: "Lafia Merchant",
                                style = MaterialTheme.typography.titleMedium,
                                fontWeight = FontWeight.Bold
                            )
                            if (currentVendor?.isVerified == true) {
                                Icon(
                                    Icons.Default.Verified,
                                    contentDescription = "Verified",
                                    tint = MaterialTheme.colorScheme.primary,
                                    modifier = Modifier.size(16.dp)
                                )
                            }
                            Surface(
                                color = MaterialTheme.colorScheme.tertiaryContainer,
                                shape = RoundedCornerShape(4.dp)
                            ) {
                                Text(
                                    text = "SIMULATION",
                                    fontSize = 9.sp,
                                    fontWeight = FontWeight.Bold,
                                    color = MaterialTheme.colorScheme.onTertiaryContainer,
                                    modifier = Modifier.padding(horizontal = 4.dp, vertical = 2.dp)
                                )
                            }
                        }
                        Text(
                            text = "${currentVendor?.areaInLafia ?: "Lafia"} • Delivery Radius: ${String.format("%.0f", currentVendor?.deliveryRadiusKm ?: 8.0)} km",
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant
                        )
                    }

                    Button(
                        onClick = { showUploadModal = true },
                        shape = RoundedCornerShape(12.dp),
                        colors = ButtonDefaults.buttonColors(containerColor = MaterialTheme.colorScheme.primary),
                        modifier = Modifier.testTag("open_upload_video_button")
                    ) {
                        Icon(Icons.Default.VideoCall, contentDescription = null, modifier = Modifier.size(16.dp))
                        Spacer(modifier = Modifier.width(4.dp))
                        Text("Upload Video", fontSize = 12.sp, fontWeight = FontWeight.Bold)
                    }
                }

                // Switch Vendor Carousel (for testing multiple Lafia merchants)
                Text(
                    text = "Switch Active Lafia Merchant:",
                    style = MaterialTheme.typography.labelSmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant
                )
                LazyRow(
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                    modifier = Modifier.fillMaxWidth()
                ) {
                    items(allVendors) { v ->
                        val isSelected = v.id == currentVendor?.id
                        FilterChip(
                            selected = isSelected,
                            onClick = { onSelectVendor(v.id) },
                            label = { Text(v.name.take(18) + if (v.name.length > 18) "..." else "", fontSize = 11.sp) },
                            leadingIcon = if (isSelected) {
                                { Icon(Icons.Default.Check, contentDescription = null, modifier = Modifier.size(12.dp)) }
                            } else null
                        )
                    }
                }
            }
        }

        // Metrics Banner
        Card(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 14.dp, vertical = 8.dp),
            colors = CardDefaults.cardColors(
                containerColor = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.5f)
            ),
            shape = RoundedCornerShape(16.dp)
        ) {
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(14.dp),
                horizontalArrangement = Arrangement.SpaceAround,
                verticalAlignment = Alignment.CenterVertically
            ) {
                Column(horizontalAlignment = Alignment.CenterHorizontally) {
                    Text("Total Sales", fontSize = 11.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    Text(
                        "₦${nairaFormat.format(currentVendor?.totalSalesNaira ?: 0.0)}",
                        fontWeight = FontWeight.Bold,
                        fontSize = 15.sp,
                        color = MaterialTheme.colorScheme.onSurface
                    )
                }
                Box(modifier = Modifier.width(1.dp).height(30.dp).background(MaterialTheme.colorScheme.outline.copy(alpha = 0.3f)))
                Column(horizontalAlignment = Alignment.CenterHorizontally) {
                    Text("Net Earnings (95%)", fontSize = 11.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    Text(
                        "₦${nairaFormat.format(currentVendor?.netEarningsNaira ?: 0.0)}",
                        fontWeight = FontWeight.Bold,
                        fontSize = 15.sp,
                        color = MaterialTheme.colorScheme.primary
                    )
                }
                Box(modifier = Modifier.width(1.dp).height(30.dp).background(MaterialTheme.colorScheme.outline.copy(alpha = 0.3f)))
                Column(horizontalAlignment = Alignment.CenterHorizontally) {
                    Text("Commission Paid (5%)", fontSize = 11.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    Text(
                        "₦${nairaFormat.format(currentVendor?.commissionPaidNaira ?: 0.0)}",
                        fontWeight = FontWeight.Bold,
                        fontSize = 15.sp,
                        color = Color(0xFFD97706)
                    )
                }
            }
        }

        // Tabs: Orders / Videos / Settlements
        TabRow(
            selectedTabIndex = selectedVendorTab,
            containerColor = MaterialTheme.colorScheme.surface
        ) {
            Tab(
                selected = selectedVendorTab == 0,
                onClick = { selectedVendorTab = 0 },
                text = { Text("Orders (${vendorOrders.size})", fontWeight = FontWeight.Bold, fontSize = 12.sp) }
            )
            Tab(
                selected = selectedVendorTab == 1,
                onClick = { selectedVendorTab = 1 },
                text = { Text("Videos (${vendorVideos.size})", fontWeight = FontWeight.Bold, fontSize = 12.sp) }
            )
            Tab(
                selected = selectedVendorTab == 2,
                onClick = { selectedVendorTab = 2 },
                text = { Text("Payouts & Bank", fontWeight = FontWeight.Bold, fontSize = 12.sp) }
            )
        }

        // Content
        when (selectedVendorTab) {
            0 -> {
                // Orders Fulfillment Tab
                if (vendorOrders.isEmpty()) {
                    Box(
                        modifier = Modifier.fillMaxSize().padding(24.dp),
                        contentAlignment = Alignment.Center
                    ) {
                        Text("No orders placed for this vendor yet.", color = MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                } else {
                    LazyColumn(
                        modifier = Modifier.fillMaxSize().padding(horizontal = 14.dp),
                        contentPadding = PaddingValues(top = 12.dp, bottom = 80.dp),
                        verticalArrangement = Arrangement.spacedBy(12.dp)
                    ) {
                        items(vendorOrders, key = { it.id }) { order ->
                            VendorOrderFulfillmentCard(
                                order = order,
                                onAccept = { onAcceptOrder(order.id) },
                                onDispatch = { onDispatchOrder(order.id) },
                                onMarkDelivered = { onMarkDelivered(order.id) }
                            )
                        }
                    }
                }
            }
            1 -> {
                // Video Catalog Tab
                LazyColumn(
                    modifier = Modifier.fillMaxSize().padding(horizontal = 14.dp),
                    contentPadding = PaddingValues(top = 12.dp, bottom = 80.dp),
                    verticalArrangement = Arrangement.spacedBy(10.dp)
                ) {
                    items(vendorVideos, key = { it.id }) { video ->
                        Card(
                            modifier = Modifier.fillMaxWidth(),
                            shape = RoundedCornerShape(14.dp),
                            colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface)
                        ) {
                            Row(
                                modifier = Modifier.fillMaxWidth().padding(12.dp),
                                horizontalArrangement = Arrangement.spacedBy(12.dp),
                                verticalAlignment = Alignment.CenterVertically
                            ) {
                                Box(
                                    modifier = Modifier
                                        .size(54.dp)
                                        .clip(RoundedCornerShape(10.dp))
                                        .background(Color(video.videoGradientStart)),
                                    contentAlignment = Alignment.Center
                                ) {
                                    Icon(Icons.Default.PlayArrow, contentDescription = null, tint = Color.White)
                                }
                                Column(modifier = Modifier.weight(1f)) {
                                    Text(video.title, fontWeight = FontWeight.Bold, maxLines = 1)
                                    Text("Category: ${video.category} • Radius: ${String.format("%.0f", video.deliveryRadiusKm)} km", fontSize = 11.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
                                    Text("₦${nairaFormat.format(video.priceNaira)} • Stock: ${video.stockQuantity}", fontWeight = FontWeight.Bold, color = MaterialTheme.colorScheme.primary, fontSize = 12.sp)
                                }
                                Surface(
                                    color = if (video.moderationStatus == "APPROVED") Color(0xFF10B981).copy(alpha = 0.15f) else Color(0xFFF59E0B).copy(alpha = 0.15f),
                                    shape = RoundedCornerShape(8.dp)
                                ) {
                                    Text(
                                        text = video.moderationStatus,
                                        color = if (video.moderationStatus == "APPROVED") Color(0xFF10B981) else Color(0xFFF59E0B),
                                        fontSize = 10.sp,
                                        fontWeight = FontWeight.Bold,
                                        modifier = Modifier.padding(horizontal = 6.dp, vertical = 3.dp)
                                    )
                                }
                            }
                        }
                    }
                }
            }
            2 -> {
                // Payouts & Bank Tab
                Column(
                    modifier = Modifier
                        .fillMaxSize()
                        .padding(16.dp)
                        .verticalScroll(rememberScrollState()),
                    verticalArrangement = Arrangement.spacedBy(16.dp)
                ) {
                    Card(
                        modifier = Modifier.fillMaxWidth(),
                        shape = RoundedCornerShape(18.dp),
                        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.primaryContainer.copy(alpha = 0.4f))
                    ) {
                        Column(modifier = Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                            Text("Settlement Balance Available", style = MaterialTheme.typography.titleSmall)
                            Text(
                                "₦${nairaFormat.format(currentVendor?.pendingSettlementNaira ?: 0.0)}",
                                style = MaterialTheme.typography.headlineMedium,
                                fontWeight = FontWeight.Bold,
                                color = MaterialTheme.colorScheme.primary
                            )
                            Text("Automatic 5% platform commission is already deducted from this payout balance.", fontSize = 11.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)

                            Button(
                                onClick = { showPayoutModal = true },
                                modifier = Modifier.fillMaxWidth().testTag("request_payout_button"),
                                shape = RoundedCornerShape(12.dp)
                            ) {
                                Icon(Icons.Default.AccountBalance, contentDescription = null)
                                Spacer(modifier = Modifier.width(8.dp))
                                Text("Request Bank Settlement Payout")
                            }
                        }
                    }

                    Card(
                        modifier = Modifier.fillMaxWidth(),
                        shape = RoundedCornerShape(16.dp),
                        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface)
                    ) {
                        Column(modifier = Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                            Text("Registered Nigerian Bank Account (Lafia):", fontWeight = FontWeight.Bold, style = MaterialTheme.typography.titleSmall)
                            Text("Bank: ${currentVendor?.bankName ?: "First Bank Lafia"}", style = MaterialTheme.typography.bodyMedium)
                            Text("Account Number: ${currentVendor?.bankAccountNumber ?: "0123456789"}", style = MaterialTheme.typography.bodyMedium)
                            Text("Account Name: ${currentVendor?.bankAccountName?.ifBlank { currentVendor.name } ?: currentVendor?.name ?: "Vendor Account"}", style = MaterialTheme.typography.bodyMedium)
                        }
                    }
                }
            }
        }
    }

    // Modal: Upload Video
    if (showUploadModal) {
        UploadVideoDialog(
            onDismiss = { showUploadModal = false },
            onPublish = { title, desc, cat, price, stock, rad ->
                onUploadVideo(title, desc, cat, price, stock, rad)
                showUploadModal = false
            }
        )
    }

    // Modal: Payout Settlement
    if (showPayoutModal) {
        RequestPayoutDialog(
            pendingNaira = currentVendor?.pendingSettlementNaira ?: 0.0,
            bankName = currentVendor?.bankName ?: "First Bank Lafia",
            accountNumber = currentVendor?.bankAccountNumber ?: "0123456789",
            onDismiss = { showPayoutModal = false },
            onConfirm = { amount ->
                onRequestSettlement(amount)
                showPayoutModal = false
            }
        )
    }
}

@Composable
fun VendorOrderFulfillmentCard(
    order: MarketOrder,
    onAccept: () -> Unit,
    onDispatch: () -> Unit,
    onMarkDelivered: () -> Unit
) {
    val nairaFormat = remember { DecimalFormat("#,##0") }

    Card(
        modifier = Modifier.fillMaxWidth().testTag("vendor_order_card_${order.orderNumber}"),
        shape = RoundedCornerShape(16.dp),
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
        elevation = CardDefaults.cardElevation(defaultElevation = 3.dp)
    ) {
        Column(modifier = Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                Column {
                    Text("Order #${order.orderNumber}", fontWeight = FontWeight.Bold, style = MaterialTheme.typography.titleSmall)
                    Text("Customer: ${order.buyerName} (${order.buyerPhone})", fontSize = 11.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
                Surface(
                    color = when (order.status) {
                        "PLACED" -> Color(0xFFF59E0B).copy(alpha = 0.15f)
                        "ACCEPTED" -> Color(0xFF3B82F6).copy(alpha = 0.15f)
                        "OUT_FOR_DELIVERY" -> Color(0xFF8B5CF6).copy(alpha = 0.15f)
                        "DELIVERED" -> Color(0xFF10B981).copy(alpha = 0.15f)
                        else -> Color.Gray.copy(alpha = 0.15f)
                    },
                    shape = RoundedCornerShape(8.dp)
                ) {
                    Text(
                        text = order.status.replace("_", " "),
                        color = when (order.status) {
                            "PLACED" -> Color(0xFFF59E0B)
                            "ACCEPTED" -> Color(0xFF3B82F6)
                            "OUT_FOR_DELIVERY" -> Color(0xFF8B5CF6)
                            "DELIVERED" -> Color(0xFF10B981)
                            else -> Color.Gray
                        },
                        fontSize = 11.sp,
                        fontWeight = FontWeight.Bold,
                        modifier = Modifier.padding(horizontal = 8.dp, vertical = 4.dp)
                    )
                }
            }

            Text(order.productTitle, style = MaterialTheme.typography.bodyMedium, fontWeight = FontWeight.SemiBold)
            Text("Delivery Destination: ${order.buyerAddress}, ${order.buyerAreaInLafia} (${String.format("%.1f", order.distanceKm)} km)", fontSize = 11.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)

            Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                Text("Total: ₦${nairaFormat.format(order.totalNaira)}", fontWeight = FontWeight.Bold)
                Text("Your Net: ₦${nairaFormat.format(order.vendorNetNaira)} (5% commission deducted)", color = MaterialTheme.colorScheme.primary, fontSize = 11.sp, fontWeight = FontWeight.SemiBold)
            }

            // Fulfillment Action Buttons (State Machine)
            when (order.status) {
                "PLACED" -> {
                    Button(
                        onClick = onAccept,
                        modifier = Modifier.fillMaxWidth().testTag("vendor_accept_order_btn_${order.orderNumber}"),
                        colors = ButtonDefaults.buttonColors(containerColor = MaterialTheme.colorScheme.primary)
                    ) {
                        Icon(Icons.Default.Check, contentDescription = null, modifier = Modifier.size(16.dp))
                        Spacer(modifier = Modifier.width(6.dp))
                        Text("Accept Order & Start Preparing")
                    }
                }
                "ACCEPTED" -> {
                    Button(
                        onClick = onDispatch,
                        modifier = Modifier.fillMaxWidth().testTag("vendor_dispatch_order_btn_${order.orderNumber}"),
                        colors = ButtonDefaults.buttonColors(containerColor = Color(0xFF7C3AED))
                    ) {
                        Icon(Icons.Default.TwoWheeler, contentDescription = null, modifier = Modifier.size(16.dp))
                        Spacer(modifier = Modifier.width(6.dp))
                        Text("Hand Over to Lafia Express Rider (Dispatch)")
                    }
                }
                "OUT_FOR_DELIVERY" -> {
                    Button(
                        onClick = onMarkDelivered,
                        modifier = Modifier.fillMaxWidth().testTag("vendor_mark_delivered_btn_${order.orderNumber}"),
                        colors = ButtonDefaults.buttonColors(containerColor = Color(0xFF10B981))
                    ) {
                        Icon(Icons.Default.DoneAll, contentDescription = null, modifier = Modifier.size(16.dp))
                        Spacer(modifier = Modifier.width(6.dp))
                        Text("Confirm Delivered (Book 5% Commission & Net Revenue)")
                    }
                }
                "DELIVERED" -> {
                    Surface(
                        modifier = Modifier.fillMaxWidth(),
                        color = Color(0xFF10B981).copy(alpha = 0.1f),
                        shape = RoundedCornerShape(8.dp)
                    ) {
                        Row(modifier = Modifier.padding(8.dp), verticalAlignment = Alignment.CenterVertically) {
                            Icon(Icons.Default.CheckCircle, contentDescription = null, tint = Color(0xFF10B981), modifier = Modifier.size(16.dp))
                            Spacer(modifier = Modifier.width(6.dp))
                            Text("Delivered & 5% Commission recorded in Staff Ledger", color = Color(0xFF047857), fontSize = 11.sp, fontWeight = FontWeight.Medium)
                        }
                    }
                }
            }
        }
    }
}

@Composable
fun UploadVideoDialog(
    onDismiss: () -> Unit,
    onPublish: (title: String, desc: String, category: String, price: Double, stock: Int, radiusKm: Double) -> Unit
) {
    var title by remember { mutableStateOf("") }
    var desc by remember { mutableStateOf("") }
    var category by remember { mutableStateOf("Grains & Tubers") }
    var priceText by remember { mutableStateOf("12000") }
    var stockText by remember { mutableStateOf("20") }
    var radiusKm by remember { mutableStateOf(8.0) }

    val categories = listOf("Grains & Tubers", "Fresh Produce", "Fashion & Aso-Oke", "Herbs & Spices", "Tech & Gadgets", "Fish & Agro")

    Dialog(onDismissRequest = onDismiss) {
        Card(
            modifier = Modifier.fillMaxWidth().padding(vertical = 16.dp).testTag("upload_video_dialog"),
            shape = RoundedCornerShape(20.dp)
        ) {
            Column(
                modifier = Modifier.padding(18.dp).verticalScroll(rememberScrollState()),
                verticalArrangement = Arrangement.spacedBy(10.dp)
            ) {
                Text("Upload Product Video", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold)

                OutlinedTextField(
                    value = title,
                    onValueChange = { title = it },
                    label = { Text("Product Video Title") },
                    modifier = Modifier.fillMaxWidth().testTag("upload_title_input")
                )

                OutlinedTextField(
                    value = desc,
                    onValueChange = { desc = it },
                    label = { Text("Product Description & Harvest Details") },
                    modifier = Modifier.fillMaxWidth().testTag("upload_desc_input")
                )

                Text("Category:", style = MaterialTheme.typography.labelSmall)
                LazyRow(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                    items(categories) { cat ->
                        FilterChip(
                            selected = category == cat,
                            onClick = { category = cat },
                            label = { Text(cat, fontSize = 11.sp) }
                        )
                    }
                }

                Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    OutlinedTextField(
                        value = priceText,
                        onValueChange = { priceText = it },
                        label = { Text("Price (₦)") },
                        modifier = Modifier.weight(1f).testTag("upload_price_input")
                    )
                    OutlinedTextField(
                        value = stockText,
                        onValueChange = { stockText = it },
                        label = { Text("Stock Qty") },
                        modifier = Modifier.weight(1f).testTag("upload_stock_input")
                    )
                }

                Text("Lafia Delivery Radius: ${String.format("%.0f", radiusKm)} km", style = MaterialTheme.typography.labelSmall)
                Slider(
                    value = radiusKm.toFloat(),
                    onValueChange = { radiusKm = it.toDouble() },
                    valueRange = 2f..20f,
                    steps = 9
                )

                Button(
                    onClick = {
                        val price = priceText.toDoubleOrNull() ?: 10000.0
                        val stock = stockText.toIntOrNull() ?: 10
                        onPublish(title.ifBlank { "Lafia Market Item" }, desc.ifBlank { "Direct from local Lafia vendor" }, category, price, stock, radiusKm)
                    },
                    modifier = Modifier.fillMaxWidth().height(48.dp).testTag("publish_video_button"),
                    shape = RoundedCornerShape(12.dp)
                ) {
                    Icon(Icons.Default.Publish, contentDescription = null)
                    Spacer(modifier = Modifier.width(6.dp))
                    Text("Publish Video to Lafia Hub")
                }
            }
        }
    }
}

@Composable
fun RequestPayoutDialog(
    pendingNaira: Double,
    bankName: String,
    accountNumber: String,
    onDismiss: () -> Unit,
    onConfirm: (Double) -> Unit
) {
    val nairaFormat = remember { DecimalFormat("#,##0") }
    var amountText by remember { mutableStateOf(if (pendingNaira > 0) "${pendingNaira.toInt()}" else "20000") }

    Dialog(onDismissRequest = onDismiss) {
        Card(modifier = Modifier.fillMaxWidth().padding(16.dp), shape = RoundedCornerShape(18.dp)) {
            Column(modifier = Modifier.padding(18.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                Text("Request Settlement Payout", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold)
                Text("Settlement Account: $bankName ($accountNumber)", fontSize = 12.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)

                OutlinedTextField(
                    value = amountText,
                    onValueChange = { amountText = it },
                    label = { Text("Payout Amount (₦)") },
                    modifier = Modifier.fillMaxWidth()
                )

                Button(
                    onClick = {
                        val amt = amountText.toDoubleOrNull() ?: 20000.0
                        onConfirm(amt)
                    },
                    modifier = Modifier.fillMaxWidth()
                ) {
                    Text("Submit Settlement Request")
                }
            }
        }
    }
}
