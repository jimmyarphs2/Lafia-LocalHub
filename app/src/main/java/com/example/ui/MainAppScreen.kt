package com.example.ui

import androidx.compose.animation.*
import androidx.compose.foundation.background
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material.icons.outlined.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.window.Dialog
import androidx.lifecycle.viewmodel.compose.viewModel
import com.example.data.model.MarketOrder
import com.example.ui.screens.*
import com.example.ui.theme.LocalHubTheme
import java.text.DecimalFormat

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun MainAppScreen(viewModel: LocalHubViewModel = viewModel()) {
    val uiState by viewModel.uiState.collectAsState()
    val snackbarHostState = remember { SnackbarHostState() }
    val nairaFormat = remember { DecimalFormat("#,##0") }

    val isDark = when (uiState.themePreference) {
        ThemePreference.SYSTEM -> isSystemInDarkTheme()
        ThemePreference.LIGHT -> false
        ThemePreference.DARK -> true
    }

    var buyerNavigationTab by remember { mutableStateOf(0) } // 0: Video Feed, 1: AI Chat, 2: Cart & Tracking

    LaunchedEffect(uiState.snackbarMessage) {
        uiState.snackbarMessage?.let { msg ->
            snackbarHostState.showSnackbar(msg)
            viewModel.clearSnackbar()
        }
    }

    LocalHubTheme(darkTheme = isDark) {
        Scaffold(
            snackbarHost = { SnackbarHost(snackbarHostState) },
            topBar = {
                Surface(
                    color = MaterialTheme.colorScheme.surface,
                    tonalElevation = 3.dp
                ) {
                    Column(modifier = Modifier.statusBarsPadding()) {
                        // Top Header with App Identity, Theme Switcher & Role Selector
                        Row(
                            modifier = Modifier
                                .fillMaxWidth()
                                .padding(horizontal = 14.dp, vertical = 8.dp),
                            horizontalArrangement = Arrangement.SpaceBetween,
                            verticalAlignment = Alignment.CenterVertically
                        ) {
                            // App Brand Identity
                            Row(
                                verticalAlignment = Alignment.CenterVertically,
                                horizontalArrangement = Arrangement.spacedBy(8.dp)
                            ) {
                                Box(
                                    modifier = Modifier
                                        .size(34.dp)
                                        .clip(RoundedCornerShape(10.dp))
                                        .background(MaterialTheme.colorScheme.primary),
                                    contentAlignment = Alignment.Center
                                ) {
                                    Icon(
                                        imageVector = Icons.Default.PlayArrow,
                                        contentDescription = null,
                                        tint = Color.White,
                                        modifier = Modifier.size(20.dp)
                                    )
                                }
                                Column {
                                    Text(
                                        text = "LocalHub Lafia",
                                        style = MaterialTheme.typography.titleMedium,
                                        fontWeight = FontWeight.Bold,
                                        color = MaterialTheme.colorScheme.onSurface
                                    )
                                    Text(
                                        text = "Video-First Marketplace",
                                        style = MaterialTheme.typography.labelSmall,
                                        color = MaterialTheme.colorScheme.primary
                                    )
                                }
                            }

                            // Theme Mode & Account Switcher
                            Row(
                                verticalAlignment = Alignment.CenterVertically,
                                horizontalArrangement = Arrangement.spacedBy(2.dp)
                            ) {
                                IconButton(
                                    onClick = { viewModel.toggleAccountSwitcherDialog(true) },
                                    modifier = Modifier.testTag("account_security_button")
                                ) {
                                    Icon(
                                        imageVector = Icons.Default.AccountCircle,
                                        contentDescription = "Authenticated Account & RBAC Simulator"
                                    )
                                }
                                IconButton(
                                    onClick = {
                                        val nextTheme = when (uiState.themePreference) {
                                            ThemePreference.SYSTEM -> ThemePreference.LIGHT
                                            ThemePreference.LIGHT -> ThemePreference.DARK
                                            ThemePreference.DARK -> ThemePreference.SYSTEM
                                        }
                                        viewModel.setThemePreference(nextTheme)
                                    },
                                    modifier = Modifier.testTag("theme_switcher_button")
                                ) {
                                    Icon(
                                        imageVector = when (uiState.themePreference) {
                                            ThemePreference.SYSTEM -> Icons.Default.BrightnessAuto
                                            ThemePreference.LIGHT -> Icons.Default.LightMode
                                            ThemePreference.DARK -> Icons.Default.DarkMode
                                        },
                                        contentDescription = "Theme Switcher"
                                    )
                                }
                            }
                        }

                        // Simulation Warning Banner across all views
                        Surface(
                            color = MaterialTheme.colorScheme.primaryContainer.copy(alpha = 0.4f),
                            modifier = Modifier.fillMaxWidth()
                        ) {
                            Row(
                                modifier = Modifier
                                    .fillMaxWidth()
                                    .padding(horizontal = 14.dp, vertical = 4.dp),
                                verticalAlignment = Alignment.CenterVertically,
                                horizontalArrangement = Arrangement.SpaceBetween
                            ) {
                                Row(
                                    verticalAlignment = Alignment.CenterVertically,
                                    horizontalArrangement = Arrangement.spacedBy(4.dp)
                                ) {
                                    Icon(
                                        imageVector = Icons.Default.Info,
                                        contentDescription = null,
                                        tint = MaterialTheme.colorScheme.primary,
                                        modifier = Modifier.size(13.dp)
                                    )
                                    Text(
                                        text = "SIMULATION: Videos, ₦ Payments, 5% Commission & Rider Telemetry",
                                        style = MaterialTheme.typography.labelSmall,
                                        fontSize = 10.sp,
                                        fontWeight = FontWeight.Bold,
                                        color = MaterialTheme.colorScheme.onPrimaryContainer
                                    )
                                }
                                Text(
                                    text = "User: ${uiState.currentAccount.name.take(12)}..",
                                    style = MaterialTheme.typography.labelSmall,
                                    fontSize = 10.sp,
                                    fontWeight = FontWeight.Medium,
                                    color = MaterialTheme.colorScheme.primary
                                )
                            }
                        }
                        Spacer(modifier = Modifier.height(2.dp))
                    }
                }
            },
            bottomBar = {
                // Bottom Navigation Bar only for Buyer Experience
                if (uiState.currentRole == UserRole.BUYER) {
                    NavigationBar(
                        containerColor = MaterialTheme.colorScheme.surface,
                        tonalElevation = 8.dp
                    ) {
                        NavigationBarItem(
                            selected = buyerNavigationTab == 0,
                            onClick = { buyerNavigationTab = 0 },
                            icon = {
                                Icon(
                                    imageVector = if (buyerNavigationTab == 0) Icons.Default.VideoLibrary else Icons.Outlined.VideoLibrary,
                                    contentDescription = "Video Feed"
                                )
                            },
                            label = { Text("Video Feed", fontSize = 11.sp) },
                            modifier = Modifier.testTag("buyer_nav_feed")
                        )

                        NavigationBarItem(
                            selected = buyerNavigationTab == 1,
                            onClick = { buyerNavigationTab = 1 },
                            icon = {
                                Icon(
                                    imageVector = if (buyerNavigationTab == 1) Icons.Default.SmartToy else Icons.Outlined.SmartToy,
                                    contentDescription = "AI Assistant"
                                )
                            },
                            label = { Text("AI Assistant", fontSize = 11.sp) },
                            modifier = Modifier.testTag("buyer_nav_ai_chat")
                        )

                        NavigationBarItem(
                            selected = buyerNavigationTab == 2,
                            onClick = { buyerNavigationTab = 2 },
                            icon = {
                                BadgedBox(
                                    badge = {
                                        if (uiState.cartItems.isNotEmpty()) {
                                            Badge { Text("${uiState.cartItems.size}") }
                                        }
                                    }
                                ) {
                                    Icon(
                                        imageVector = if (buyerNavigationTab == 2) Icons.Default.ShoppingBag else Icons.Outlined.ShoppingBag,
                                        contentDescription = "Cart & Track"
                                    )
                                }
                            },
                            label = { Text("Cart & Track", fontSize = 11.sp) },
                            modifier = Modifier.testTag("buyer_nav_cart_track")
                        )
                    }
                }
            }
        ) { paddingValues ->
            Box(
                modifier = Modifier
                    .fillMaxSize()
                    .padding(paddingValues)
            ) {
                when (uiState.currentRole) {
                    UserRole.BUYER -> {
                        when (buyerNavigationTab) {
                            0 -> {
                                BuyerVideoFeedScreen(
                                    videos = uiState.activeVideos,
                                    selectedCategory = uiState.selectedCategory,
                                    searchQuery = uiState.searchQuery,
                                    maxDistanceKm = uiState.maxDistanceKm,
                                    feedMode = uiState.feedMode,
                                    onCategorySelected = { viewModel.setSelectedCategory(it) },
                                    onSearchQueryChanged = { viewModel.setSearchQuery(it) },
                                    onMaxDistanceChanged = { viewModel.setMaxDistanceKm(it) },
                                    onToggleFeedMode = { viewModel.setFeedMode(it) },
                                    onAddToCart = { viewModel.addToCart(it) },
                                    onInstantCheckout = { viewModel.initiateCheckoutForProduct(it) }
                                )
                            }
                            1 -> {
                                AiShoppingChatScreen(
                                    messages = uiState.aiMessages,
                                    inputText = uiState.aiInputText,
                                    isThinking = uiState.isAiThinking,
                                    onInputChanged = { viewModel.updateAiInput(it) },
                                    onSendMessage = { viewModel.sendAiPrompt() },
                                    onReviewDraftOrder = { viewModel.initiateCheckoutFromAiDraft(it) }
                                )
                            }
                            2 -> {
                                BuyerCartAndTrackingScreen(
                                    cartItems = uiState.cartItems,
                                    orders = uiState.buyerOrders,
                                    selectedOrder = uiState.selectedTrackingOrder,
                                    onRemoveFromCart = { viewModel.removeFromCart(it) },
                                    onCheckoutCartItem = { viewModel.initiateCheckoutForCartItem(it) },
                                    onSelectOrderForTracking = { viewModel.selectOrderForTracking(it) },
                                    onOpenDispute = { viewModel.openDisputeDialog(it) }
                                )
                            }
                        }
                    }
                    UserRole.VENDOR -> {
                        VendorDashboardScreen(
                            currentVendor = uiState.currentVendor,
                            allVendors = uiState.allVendors,
                            vendorVideos = uiState.vendorVideos.ifEmpty { uiState.moderationVideos.filter { it.vendorId == uiState.selectedVendorId } },
                            vendorOrders = uiState.vendorOrders,
                            onSelectVendor = { viewModel.setSelectedVendor(it) },
                            onUploadVideo = { title, desc, cat, price, stock, rad ->
                                viewModel.uploadProductVideo(title, desc, cat, price, stock, rad)
                            },
                            onRequestSettlement = { viewModel.requestSettlementPayout(it) },
                            onAcceptOrder = { viewModel.vendorAcceptOrder(it) },
                            onDispatchOrder = { viewModel.vendorDispatchOrder(it) },
                            onMarkDelivered = { viewModel.markOrderDelivered(it) }
                        )
                    }
                    UserRole.STAFF -> {
                        StaffAdminScreen(
                            vendors = uiState.allVendors,
                            moderationVideos = uiState.moderationVideos,
                            ledgerEntries = uiState.staffLedgerEntries,
                            disputes = uiState.allDisputes,
                            pendingSettlements = uiState.pendingSettlements,
                            totalCommissionNaira = uiState.totalPlatformCommissionNaira,
                            totalPayoutsNaira = uiState.totalVendorPayoutsNaira,
                            onVerifyVendor = { vId, approved -> viewModel.verifyVendor(vId, approved) },
                            onModerateVideo = { vId, status -> viewModel.moderateVideo(vId, status) },
                            onResolveDispute = { dispute, outcome, note -> viewModel.resolveDispute(dispute, outcome, note) },
                            onApproveSettlement = { viewModel.approveSettlementRequest(it) }
                        )
                    }
                }

                // Global Mock Payment Checkout Dialog
                if (uiState.showCheckoutDialog && uiState.checkoutCartItem != null) {
                    CheckoutAndMockPayDialog(
                        cartItem = uiState.checkoutCartItem!!,
                        buyerName = uiState.checkoutBuyerName,
                        buyerPhone = uiState.checkoutBuyerPhone,
                        buyerAddress = uiState.checkoutBuyerAddress,
                        buyerArea = uiState.checkoutBuyerArea,
                        selectedPaymentMethod = uiState.selectedPaymentMethod,
                        isProcessing = uiState.isPaymentProcessing,
                        onFormChange = { name, phone, address, area, method ->
                            viewModel.updateCheckoutForm(name, phone, address, area, method)
                        },
                        onConfirmPayment = { viewModel.confirmAndPayMockOrder() },
                        onDismiss = { viewModel.closeCheckoutDialog() }
                    )
                }

                // Order Success Modal
                if (uiState.showOrderSuccessDialog && uiState.lastCompletedOrder != null) {
                    val order = uiState.lastCompletedOrder!!
                    Dialog(onDismissRequest = { viewModel.dismissOrderSuccessDialog() }) {
                        Card(
                            modifier = Modifier
                                .fillMaxWidth()
                                .padding(16.dp)
                                .testTag("order_success_dialog"),
                            shape = RoundedCornerShape(22.dp)
                        ) {
                            Column(
                                modifier = Modifier.padding(20.dp),
                                horizontalAlignment = Alignment.CenterHorizontally,
                                verticalArrangement = Arrangement.spacedBy(12.dp)
                            ) {
                                Box(
                                    modifier = Modifier
                                        .size(60.dp)
                                        .clip(CircleShape)
                                        .background(Color(0xFF10B981).copy(alpha = 0.15f)),
                                    contentAlignment = Alignment.Center
                                ) {
                                    Icon(
                                        Icons.Default.CheckCircle,
                                        contentDescription = null,
                                        tint = Color(0xFF10B981),
                                        modifier = Modifier.size(36.dp)
                                    )
                                }

                                Text(
                                    text = "Mock Payment Verified!",
                                    style = MaterialTheme.typography.titleLarge,
                                    fontWeight = FontWeight.Bold
                                )

                                Text(
                                    text = "Order #${order.orderNumber} placed with ${order.vendorName}.\nTotal: ₦${nairaFormat.format(order.totalNaira)}",
                                    style = MaterialTheme.typography.bodyMedium,
                                    color = MaterialTheme.colorScheme.onSurfaceVariant
                                )

                                Surface(
                                    color = MaterialTheme.colorScheme.surfaceVariant,
                                    shape = RoundedCornerShape(10.dp),
                                    modifier = Modifier.fillMaxWidth()
                                ) {
                                    Column(modifier = Modifier.padding(10.dp)) {
                                        Text("Next Step in Journey:", fontWeight = FontWeight.Bold, fontSize = 12.sp)
                                        Text("Switch to 'Vendor Hub' to Accept & Dispatch the order, then observe 5% Commission recorded in Staff Ledger!", fontSize = 11.sp)
                                    }
                                }

                                Button(
                                    onClick = {
                                        viewModel.dismissOrderSuccessDialog()
                                        buyerNavigationTab = 2 // switch to Track tab
                                    },
                                    modifier = Modifier.fillMaxWidth(),
                                    shape = RoundedCornerShape(12.dp)
                                ) {
                                    Text("Track Live Delivery")
                                }
                            }
                        }
                    }
                }

                // Dispute Dialog
                if (uiState.showDisputeDialog && uiState.selectedOrderForDispute != null) {
                    val order = uiState.selectedOrderForDispute!!
                    DisputeDialog(
                        order = order,
                        onDismiss = { viewModel.closeDisputeDialog() },
                        onSubmit = { category, description ->
                            viewModel.submitDispute(order, category, description)
                        }
                    )
                }

                // Authenticated Account Switcher Dialog (Simulation Auth)
                if (uiState.showAccountSwitcherDialog) {
                    AccountSwitcherDialog(
                        currentAccount = uiState.currentAccount,
                        availableAccounts = uiState.availableAccounts,
                        onSelectAccount = { viewModel.switchAccount(it) },
                        onDismiss = { viewModel.toggleAccountSwitcherDialog(false) }
                    )
                }

                // Access Denied Dialog for unauthorized role access
                if (uiState.accessDeniedMessage != null) {
                    AlertDialog(
                        onDismissRequest = { viewModel.clearAccessDeniedMessage() },
                        icon = {
                            Icon(
                                Icons.Default.Lock,
                                contentDescription = null,
                                tint = MaterialTheme.colorScheme.error,
                                modifier = Modifier.size(32.dp)
                            )
                        },
                        title = { Text("Access Denied (Unauthorized Role)") },
                        text = { Text(uiState.accessDeniedMessage!!) },
                        confirmButton = {
                            Button(
                                onClick = {
                                    viewModel.clearAccessDeniedMessage()
                                    viewModel.toggleAccountSwitcherDialog(true)
                                },
                                modifier = Modifier.testTag("switch_to_authorized_account_button")
                            ) {
                                Text("Switch Account")
                            }
                        },
                        dismissButton = {
                            OutlinedButton(onClick = { viewModel.clearAccessDeniedMessage() }) {
                                Text("Dismiss")
                            }
                        }
                    )
                }
            }
        }
    }
}

@Composable
fun AccountSwitcherDialog(
    currentAccount: UserAccount,
    availableAccounts: List<UserAccount>,
    onSelectAccount: (UserAccount) -> Unit,
    onDismiss: () -> Unit
) {
    Dialog(onDismissRequest = onDismiss) {
        Card(
            modifier = Modifier
                .fillMaxWidth()
                .padding(16.dp)
                .testTag("account_switcher_dialog"),
            shape = RoundedCornerShape(22.dp)
        ) {
            Column(
                modifier = Modifier.padding(20.dp),
                verticalArrangement = Arrangement.spacedBy(12.dp)
            ) {
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Text(
                        text = "Account Authentication",
                        style = MaterialTheme.typography.titleMedium,
                        fontWeight = FontWeight.Bold
                    )
                    IconButton(onClick = onDismiss) {
                        Icon(Icons.Default.Close, contentDescription = "Close")
                    }
                }

                Text(
                    text = "In production, roles are derived from authenticated credentials. Select an authorized account to simulate role capabilities:",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant
                )

                availableAccounts.forEach { account ->
                    val isCurrent = account.email == currentAccount.email
                    Card(
                        onClick = { onSelectAccount(account) },
                        modifier = Modifier
                            .fillMaxWidth()
                            .testTag("select_account_${account.role.name.lowercase()}"),
                        shape = RoundedCornerShape(12.dp),
                        colors = CardDefaults.cardColors(
                            containerColor = if (isCurrent) MaterialTheme.colorScheme.primaryContainer else MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.5f)
                        )
                    ) {
                        Row(
                            modifier = Modifier
                                .fillMaxWidth()
                                .padding(12.dp),
                            verticalAlignment = Alignment.CenterVertically,
                            horizontalArrangement = Arrangement.spacedBy(10.dp)
                        ) {
                            Icon(
                                imageVector = when (account.role) {
                                    UserRole.BUYER -> Icons.Default.Person
                                    UserRole.VENDOR -> Icons.Default.Storefront
                                    UserRole.STAFF -> Icons.Default.Shield
                                },
                                contentDescription = null,
                                tint = if (isCurrent) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.onSurfaceVariant
                            )
                            Column(modifier = Modifier.weight(1f)) {
                                Text(
                                    text = account.name,
                                    fontWeight = FontWeight.Bold,
                                    style = MaterialTheme.typography.bodyMedium
                                )
                                Text(
                                    text = "${account.email} • Role: ${account.role.name}",
                                    fontSize = 11.sp,
                                    color = MaterialTheme.colorScheme.onSurfaceVariant
                                )
                            }
                            if (isCurrent) {
                                Icon(
                                    imageVector = Icons.Default.Check,
                                    contentDescription = "Active",
                                    tint = MaterialTheme.colorScheme.primary,
                                    modifier = Modifier.size(18.dp)
                                )
                            }
                        }
                    }
                }
            }
        }
    }
}

@Composable
fun DisputeDialog(
    order: MarketOrder,
    onDismiss: () -> Unit,
    onSubmit: (category: String, description: String) -> Unit
) {
    var category by remember { mutableStateOf("Quality Concern") }
    var description by remember { mutableStateOf("") }
    val categories = listOf("Quality Concern", "Delivery Delay", "Wrong Item Received", "Damaged Packaging")

    Dialog(onDismissRequest = onDismiss) {
        Card(
            modifier = Modifier
                .fillMaxWidth()
                .padding(16.dp)
                .testTag("dispute_submission_dialog"),
            shape = RoundedCornerShape(20.dp)
        ) {
            Column(
                modifier = Modifier.padding(18.dp),
                verticalArrangement = Arrangement.spacedBy(10.dp)
            ) {
                Text(
                    text = "Lodge Dispute for #${order.orderNumber}",
                    style = MaterialTheme.typography.titleMedium,
                    fontWeight = FontWeight.Bold
                )
                Text(
                    text = "Lafia Staff mediation will review your claim with ${order.vendorName}.",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant
                )

                Text("Reason:", style = MaterialTheme.typography.labelSmall)
                Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                    categories.forEach { cat ->
                        Row(
                            verticalAlignment = Alignment.CenterVertically,
                            modifier = Modifier.fillMaxWidth()
                        ) {
                            RadioButton(
                                selected = category == cat,
                                onClick = { category = cat }
                            )
                            Text(cat, fontSize = 12.sp)
                        }
                    }
                }

                OutlinedTextField(
                    value = description,
                    onValueChange = { description = it },
                    label = { Text("Details for Staff Review") },
                    modifier = Modifier.fillMaxWidth(),
                    minLines = 3
                )

                Button(
                    onClick = {
                        onSubmit(category, description.ifBlank { "Customer requested review of delivered items." })
                    },
                    modifier = Modifier.fillMaxWidth(),
                    shape = RoundedCornerShape(10.dp),
                    colors = ButtonDefaults.buttonColors(containerColor = MaterialTheme.colorScheme.error)
                ) {
                    Text("Submit Dispute to Staff")
                }
            }
        }
    }
}
