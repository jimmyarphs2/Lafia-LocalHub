package com.example.ui.screens

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material.icons.outlined.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.example.data.model.MarketDispute
import com.example.data.model.ProductVideo
import com.example.data.model.StaffLedgerEntry
import com.example.data.model.Vendor
import com.example.data.model.VendorSettlementRequest
import java.text.DecimalFormat
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun StaffAdminScreen(
    vendors: List<Vendor>,
    moderationVideos: List<ProductVideo>,
    ledgerEntries: List<StaffLedgerEntry>,
    disputes: List<MarketDispute>,
    pendingSettlements: List<VendorSettlementRequest>,
    totalCommissionNaira: Double,
    totalPayoutsNaira: Double,
    onVerifyVendor: (Long, Boolean) -> Unit,
    onModerateVideo: (Long, String) -> Unit,
    onResolveDispute: (MarketDispute, String, String) -> Unit,
    onApproveSettlement: (VendorSettlementRequest) -> Unit
) {
    var selectedStaffTab by remember { mutableStateOf(0) }
    val nairaFormat = remember { DecimalFormat("#,##0") }
    val dateFormat = remember { SimpleDateFormat("dd MMM, hh:mm a", Locale.getDefault()) }

    Column(
        modifier = Modifier
            .fillMaxSize()
            .testTag("staff_admin_screen")
    ) {
        // Staff Dashboard Header
        Surface(
            modifier = Modifier.fillMaxWidth(),
            color = MaterialTheme.colorScheme.surface,
            tonalElevation = 2.dp
        ) {
            Column(modifier = Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Column {
                        Text(
                            text = "Staff & Moderation Operations",
                            style = MaterialTheme.typography.titleMedium,
                            fontWeight = FontWeight.Bold
                        )
                        Text(
                            text = "LocalHub Lafia Central Control & Commission Ledger",
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant
                        )
                    }
                    Surface(
                        color = MaterialTheme.colorScheme.primaryContainer,
                        shape = RoundedCornerShape(8.dp)
                    ) {
                        Text(
                            text = "Admin Role (SIMULATION)",
                            color = MaterialTheme.colorScheme.onPrimaryContainer,
                            fontSize = 11.sp,
                            fontWeight = FontWeight.Bold,
                            modifier = Modifier.padding(horizontal = 8.dp, vertical = 4.dp)
                        )
                    }
                }
            }
        }

        // Ledger & Commission Metric Highlight
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
                    Text("Total Platform Commission (5%)", fontSize = 11.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    Text(
                        "₦${nairaFormat.format(totalCommissionNaira)}",
                        fontWeight = FontWeight.Bold,
                        fontSize = 16.sp,
                        color = MaterialTheme.colorScheme.primary
                    )
                }
                Box(modifier = Modifier.width(1.dp).height(30.dp).background(MaterialTheme.colorScheme.outline.copy(alpha = 0.3f)))
                Column(horizontalAlignment = Alignment.CenterHorizontally) {
                    Text("Pending Settlements", fontSize = 11.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    Text(
                        "${pendingSettlements.size} Requests",
                        fontWeight = FontWeight.Bold,
                        fontSize = 16.sp,
                        color = if (pendingSettlements.isNotEmpty()) Color(0xFFD97706) else MaterialTheme.colorScheme.onSurface
                    )
                }
            }
        }

        // Staff Tabs
        TabRow(
            selectedTabIndex = selectedStaffTab,
            containerColor = MaterialTheme.colorScheme.surface
        ) {
            Tab(
                selected = selectedStaffTab == 0,
                onClick = { selectedStaffTab = 0 },
                text = { Text("Vendors (${vendors.size})", fontWeight = FontWeight.Bold, fontSize = 11.sp) }
            )
            Tab(
                selected = selectedStaffTab == 1,
                onClick = { selectedStaffTab = 1 },
                text = { Text("Videos (${moderationVideos.size})", fontWeight = FontWeight.Bold, fontSize = 11.sp) }
            )
            Tab(
                selected = selectedStaffTab == 2,
                onClick = { selectedStaffTab = 2 },
                text = { Text("Disputes (${disputes.count { it.status == "OPEN" }})", fontWeight = FontWeight.Bold, fontSize = 11.sp) }
            )
            Tab(
                selected = selectedStaffTab == 3,
                onClick = { selectedStaffTab = 3 },
                text = { Text("Commission Ledger", fontWeight = FontWeight.Bold, fontSize = 11.sp) }
            )
        }

        // Content
        when (selectedStaffTab) {
            0 -> {
                // Vendor Verification Queue
                LazyColumn(
                    modifier = Modifier.fillMaxSize().padding(horizontal = 14.dp),
                    contentPadding = PaddingValues(top = 12.dp, bottom = 80.dp),
                    verticalArrangement = Arrangement.spacedBy(10.dp)
                ) {
                    items(vendors, key = { it.id }) { v ->
                        Card(
                            modifier = Modifier.fillMaxWidth().testTag("staff_vendor_card_${v.id}"),
                            shape = RoundedCornerShape(14.dp),
                            colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface)
                        ) {
                            Column(modifier = Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                                Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                                    Column(modifier = Modifier.weight(1f)) {
                                        Text(v.name, fontWeight = FontWeight.Bold, style = MaterialTheme.typography.bodyMedium)
                                        Text("Owner: ${v.ownerName} • CAC: ${v.cacNumber}", fontSize = 11.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
                                        Text("Location: ${v.address}, ${v.areaInLafia}", fontSize = 11.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
                                    }
                                    Surface(
                                        color = if (v.isVerified) Color(0xFF10B981).copy(alpha = 0.15f) else Color(0xFFF59E0B).copy(alpha = 0.15f),
                                        shape = RoundedCornerShape(8.dp)
                                    ) {
                                        Text(
                                            text = v.verificationStatus,
                                            color = if (v.isVerified) Color(0xFF10B981) else Color(0xFFF59E0B),
                                            fontSize = 11.sp,
                                            fontWeight = FontWeight.Bold,
                                            modifier = Modifier.padding(horizontal = 8.dp, vertical = 4.dp)
                                        )
                                    }
                                }

                                Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                                    if (!v.isVerified) {
                                        Button(
                                            onClick = { onVerifyVendor(v.id, true) },
                                            modifier = Modifier.weight(1f).testTag("verify_vendor_button_${v.id}"),
                                            colors = ButtonDefaults.buttonColors(containerColor = Color(0xFF10B981))
                                        ) {
                                            Icon(Icons.Default.Check, contentDescription = null, modifier = Modifier.size(16.dp))
                                            Spacer(modifier = Modifier.width(4.dp))
                                            Text("Approve & Verify", fontSize = 12.sp)
                                        }
                                    } else {
                                        OutlinedButton(
                                            onClick = { onVerifyVendor(v.id, false) },
                                            modifier = Modifier.weight(1f),
                                            colors = ButtonDefaults.outlinedButtonColors(contentColor = MaterialTheme.colorScheme.error)
                                        ) {
                                            Text("Suspend Vendor", fontSize = 12.sp)
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }
            1 -> {
                // Video Content Moderation
                LazyColumn(
                    modifier = Modifier.fillMaxSize().padding(horizontal = 14.dp),
                    contentPadding = PaddingValues(top = 12.dp, bottom = 80.dp),
                    verticalArrangement = Arrangement.spacedBy(10.dp)
                ) {
                    items(moderationVideos, key = { it.id }) { video ->
                        Card(
                            modifier = Modifier.fillMaxWidth().testTag("staff_video_mod_card_${video.id}"),
                            shape = RoundedCornerShape(14.dp),
                            colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface)
                        ) {
                            Column(modifier = Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                                Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                                    Column(modifier = Modifier.weight(1f)) {
                                        Text(video.title, fontWeight = FontWeight.Bold, style = MaterialTheme.typography.bodyMedium)
                                        Text("Merchant: ${video.vendorName} (${video.category})", fontSize = 11.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
                                        Text("Price: ₦${nairaFormat.format(video.priceNaira)}", fontSize = 11.sp, color = MaterialTheme.colorScheme.primary, fontWeight = FontWeight.Bold)
                                    }
                                    Surface(
                                        color = if (video.moderationStatus == "APPROVED") Color(0xFF10B981).copy(alpha = 0.15f) else Color(0xFFF59E0B).copy(alpha = 0.15f),
                                        shape = RoundedCornerShape(8.dp)
                                    ) {
                                        Text(
                                            text = video.moderationStatus,
                                            color = if (video.moderationStatus == "APPROVED") Color(0xFF10B981) else Color(0xFFF59E0B),
                                            fontSize = 11.sp,
                                            fontWeight = FontWeight.Bold,
                                            modifier = Modifier.padding(horizontal = 8.dp, vertical = 4.dp)
                                        )
                                    }
                                }

                                Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                                    if (video.moderationStatus != "APPROVED") {
                                        Button(
                                            onClick = { onModerateVideo(video.id, "APPROVED") },
                                            modifier = Modifier.weight(1f).testTag("approve_video_button_${video.id}"),
                                            colors = ButtonDefaults.buttonColors(containerColor = Color(0xFF10B981))
                                        ) {
                                            Text("Approve Video", fontSize = 12.sp)
                                        }
                                    }
                                    OutlinedButton(
                                        onClick = { onModerateVideo(video.id, "FLAGGED") },
                                        modifier = Modifier.weight(1f)
                                    ) {
                                        Text("Flag Content", fontSize = 12.sp)
                                    }
                                }
                            }
                        }
                    }
                }
            }
            2 -> {
                // Dispute Management Center
                if (disputes.isEmpty()) {
                    Box(modifier = Modifier.fillMaxSize().padding(24.dp), contentAlignment = Alignment.Center) {
                        Text("No active customer disputes in Lafia.", color = MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                } else {
                    LazyColumn(
                        modifier = Modifier.fillMaxSize().padding(horizontal = 14.dp),
                        contentPadding = PaddingValues(top = 12.dp, bottom = 80.dp),
                        verticalArrangement = Arrangement.spacedBy(10.dp)
                    ) {
                        items(disputes, key = { it.id }) { dispute ->
                            Card(
                                modifier = Modifier.fillMaxWidth().testTag("dispute_card_${dispute.orderNumber}"),
                                shape = RoundedCornerShape(14.dp),
                                colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface)
                            ) {
                                Column(modifier = Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                                    Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                                        Text("Dispute #${dispute.orderNumber}", fontWeight = FontWeight.Bold, style = MaterialTheme.typography.bodyMedium)
                                        Surface(
                                            color = if (dispute.status == "OPEN") Color(0xFFEF4444).copy(alpha = 0.15f) else Color(0xFF10B981).copy(alpha = 0.15f),
                                            shape = RoundedCornerShape(6.dp)
                                        ) {
                                            Text(
                                                text = dispute.status,
                                                color = if (dispute.status == "OPEN") Color(0xFFEF4444) else Color(0xFF10B981),
                                                fontSize = 10.sp,
                                                fontWeight = FontWeight.Bold,
                                                modifier = Modifier.padding(horizontal = 6.dp, vertical = 2.dp)
                                            )
                                        }
                                    }
                                    Text("Buyer: ${dispute.buyerName} vs. Vendor: ${dispute.vendorName}", fontSize = 11.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
                                    Text("Category: ${dispute.issueCategory}", fontSize = 11.sp, fontWeight = FontWeight.SemiBold)
                                    Text(dispute.issueDescription, style = MaterialTheme.typography.bodySmall)

                                    if (dispute.status == "OPEN") {
                                        Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                                            Button(
                                                onClick = { onResolveDispute(dispute, "RESOLVED_PAYOUT", "Staff verified produce harvest standards. Payout released to vendor.") },
                                                modifier = Modifier.weight(1f),
                                                colors = ButtonDefaults.buttonColors(containerColor = MaterialTheme.colorScheme.primary)
                                            ) {
                                                Text("Release to Vendor", fontSize = 11.sp)
                                            }
                                            OutlinedButton(
                                                onClick = { onResolveDispute(dispute, "RESOLVED_REFUND", "Refund approved by staff due to delivery delay.") },
                                                modifier = Modifier.weight(1f)
                                            ) {
                                                Text("Refund Buyer", fontSize = 11.sp)
                                            }
                                        }
                                    } else if (dispute.resolutionNote != null) {
                                        Text("Resolution: ${dispute.resolutionNote}", fontSize = 11.sp, color = MaterialTheme.colorScheme.primary, fontWeight = FontWeight.Medium)
                                    }
                                }
                            }
                        }
                    }
                }
            }
            3 -> {
                // Commission & Settlement Ledger
                LazyColumn(
                    modifier = Modifier.fillMaxSize().padding(horizontal = 14.dp),
                    contentPadding = PaddingValues(top = 12.dp, bottom = 80.dp),
                    verticalArrangement = Arrangement.spacedBy(10.dp)
                ) {
                    // Pending Settlements Approval Section
                    if (pendingSettlements.isNotEmpty()) {
                        item {
                            Text("Pending Vendor Bank Payouts:", fontWeight = FontWeight.Bold, style = MaterialTheme.typography.titleSmall)
                        }
                        items(pendingSettlements, key = { "settle_${it.id}" }) { req ->
                            Card(
                                modifier = Modifier.fillMaxWidth(),
                                colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.primaryContainer.copy(alpha = 0.3f)),
                                shape = RoundedCornerShape(12.dp)
                            ) {
                                Column(modifier = Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                                    Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                                        Text(req.vendorName, fontWeight = FontWeight.Bold)
                                        Text("₦${nairaFormat.format(req.amountNaira)}", fontWeight = FontWeight.Bold, color = MaterialTheme.colorScheme.primary)
                                    }
                                    Text("Bank: ${req.bankName} (${req.accountNumber})", fontSize = 11.sp)
                                    Button(
                                        onClick = { onApproveSettlement(req) },
                                        modifier = Modifier.fillMaxWidth().testTag("approve_settlement_button_${req.id}"),
                                        colors = ButtonDefaults.buttonColors(containerColor = Color(0xFF10B981))
                                    ) {
                                        Icon(Icons.Default.CheckCircle, contentDescription = null, modifier = Modifier.size(16.dp))
                                        Spacer(modifier = Modifier.width(6.dp))
                                        Text("Authorize Bank Settlement Payout")
                                    }
                                }
                            }
                        }
                        item {
                            HorizontalDivider(modifier = Modifier.padding(vertical = 8.dp))
                        }
                    }

                    item {
                        Text("5% Platform Commission Transaction Log:", fontWeight = FontWeight.Bold, style = MaterialTheme.typography.titleSmall)
                    }

                    items(ledgerEntries, key = { "ledger_${it.id}" }) { entry ->
                        Card(
                            modifier = Modifier.fillMaxWidth(),
                            shape = RoundedCornerShape(12.dp),
                            colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface)
                        ) {
                            Column(modifier = Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                                Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                                    Text(entry.orderNumber, fontWeight = FontWeight.Bold, style = MaterialTheme.typography.bodySmall)
                                    Text(
                                        text = if (entry.type == "COMMISSION_EARNED") "+₦${nairaFormat.format(entry.commissionNaira)} (5%)" else "-₦${nairaFormat.format(entry.totalOrderNaira)} (Payout)",
                                        color = if (entry.type == "COMMISSION_EARNED") Color(0xFF10B981) else Color(0xFFEF4444),
                                        fontWeight = FontWeight.Bold,
                                        fontSize = 12.sp
                                    )
                                }
                                Text(entry.note, style = MaterialTheme.typography.bodySmall, fontSize = 11.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
                                Text(dateFormat.format(Date(entry.timestamp)), fontSize = 10.sp, color = MaterialTheme.colorScheme.outline)
                            }
                        }
                    }
                }
            }
        }
    }
}
