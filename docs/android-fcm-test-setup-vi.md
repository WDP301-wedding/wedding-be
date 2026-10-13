# Lấy token FCM và đăng nhập Android thử nghiệm

Áp dụng cho app Expo SDK 57 `wedding-app` và backend FCM trực tiếp. Đội app
thực hiện các thay đổi Android dưới đây; SPEC-11 chỉ thay đổi repository backend.
Không cần tạo tài khoản Firebase Authentication: tài khoản đăng nhập là tài khoản
Wedding backend. Token FCM thuộc một bản cài app trên thiết bị, không thuộc email.

## 1. Chuẩn bị Firebase và bản Android

1. Mở Firebase Console, chọn đúng project **wdp301-wedding**.
2. Trong Project settings → General → Your apps, chọn app Android hiện có nếu
   đúng package. Nếu chưa có, Add app → Android; đội app thống nhất applicationId
   (ví dụ `com.wdp301.wedding.staging`). Điền đúng cùng giá trị vào
   `android.package` của Expo. Không đổi package của app đã phát hành.
3. Tải **google-services.json** của app Android đó vào thư mục `wedding-app`.
   Đây là cấu hình client; không đưa JSON service account/private key vào app.
4. Trong `wedding-app`, đội app chạy:

   ```powershell
   npx expo install expo-notifications expo-dev-client
   ```

5. Giữ các cấu hình/plugins hiện có, bổ sung trong `app.config.ts`:

   ```ts
   android: {
     // Giữ các thuộc tính Android hiện có.
     package: 'com.wdp301.wedding.staging', // Ví dụ; phải khớp Firebase.
     googleServicesFile: './google-services.json',
   },
   plugins: [
     // Giữ các plugins hiện có.
     'expo-notifications',
   ],
   ```

6. Cài Android Studio/Android SDK và Java theo hướng dẫn Expo. Bật Developer
   options → USB debugging trên điện thoại, kết nối USB, rồi chạy:

   ```powershell
   adb devices
   npx expo run:android --device
   ```

   Có thể dùng emulator có Google Play services. Remote push Android cần bản
   development build; Expo Go không hỗ trợ remote push từ SDK 53 trở lên.
   Sau này chỉ chạy Metro: `npx expo start --dev-client`. Nếu đổi native config
   hoặc thêm plugin, build lại. Các lệnh trên build cục bộ, không gọi EAS cloud.

## 2. Lấy native FCM token

Đội app gắn hàm sau vào một nút thử nghiệm trong development build và hiển thị
token chỉ trên màn hình thử nghiệm riêng, không ghi vào log chia sẻ:

```ts
import * as Notifications from 'expo-notifications';

export async function getAndroidFcmToken(): Promise<string> {
  await Notifications.setNotificationChannelAsync('wedding-test', {
    name: 'Wedding test',
    importance: Notifications.AndroidImportance.DEFAULT,
  });
  let permission = await Notifications.getPermissionsAsync();
  if (permission.status !== 'granted') {
    permission = await Notifications.requestPermissionsAsync();
  }
  if (permission.status !== 'granted') throw new Error('Chưa cho phép thông báo');
  const token = await Notifications.getDevicePushTokenAsync();
  if (token.type !== 'android') throw new Error('Cần thiết bị Android');
  return String(token.data);
}
```

Backend nhận **native FCM token** từ `getDevicePushTokenAsync()`.
`getExpoPushTokenAsync()` trả Expo token và không dùng cho backend này.
Token có thể đổi sau cài lại/refresh; dùng token hiện tại của đúng Firebase project.

## 3. Tài khoản và phiên Android

Trong `.env` của bản app thử, đội app đặt API base URL (đã gồm `/api/v1`):

```dotenv
EXPO_PUBLIC_API_BASE_URL=https://wedding-be-spec11-spec11-staging.up.railway.app/api/v1
```

Khởi động lại Metro sau khi đổi biến. Operator xác nhận API đã deploy/ready trước
khi đăng nhập; database/account được tạo chưa đồng nghĩa API đang phục vụ.

Tài khoản thử phải thuộc staging được phép, có role COUPLE và quyền FULL trên
booking thử, hoặc Manager có scope tương ứng. Operator tạo bằng công cụ bootstrap
backend, không sửa bảng payment để cấp quyền. Thông tin đăng nhập được lưu riêng
trong file ignored; không đưa mật khẩu/token vào PR hoặc evidence công khai.

Gọi **POST /api/v1/auth/android-sessions** trên API staging:

```json
{ "email": "EMAIL_TAI_KHOAN_THU", "password": "MAT_KHAU_THU" }
```

Đọc `data.accessToken` từ response 201. Đây phải là phiên **ANDROID**;
access token đăng nhập web không được dùng đăng ký Android installation.

Sau đó gọi **POST /api/v1/notifications/android-installations**, với:

```http
Authorization: Bearer ACCESS_TOKEN_ANDROID
Content-Type: application/json
Idempotency-Key: UUID_MOI_CHO_LAN_DANG_KY
```

```json
{
  "installationId": "UUID_ON_DINH_CUA_BAN_CAI",
  "pushToken": "NATIVE_FCM_TOKEN",
  "expectedRevision": 0
}
```

Lưu `data.id` và `data.revision`. Khi cập nhật token trên cùng installation,
dùng revision hiện tại thay cho 0 và một Idempotency-Key mới. Không tạo UUID mới
mỗi lần mở app. Lưu access/refresh token theo cơ chế secure storage của app.

## 4. Bằng chứng để đóng NTF-FCM-W4

Sau đăng ký, cung cấp **installation ID, booking ID và môi trường thử đã được phép**
cho operator; không cần đăng token vào tài liệu công khai. Operator giới hạn
account/booking, bật FCM trong thời gian thử, tạo một event nghiệp vụ native,
và kiểm tra worker ghi device attempt cùng FCM message ID/PROVIDER_ACCEPTED.
Firebase Console test-send hoặc đăng ký thành công chưa chứng minh worker backend
gửi được. Sau thử, tắt FCM và thu hồi installation/phiên thử nếu không dùng tiếp.

FCM acceptance là bằng chứng backend; việc điện thoại hiển thị, bấm thông báo
và điều hướng là bằng chứng riêng do đội app phụ trách.

Nguồn chính thức: [Expo Notifications SDK 57](https://docs.expo.dev/versions/v57.0.0/sdk/notifications/),
[Expo Firebase client credentials](https://docs.expo.dev/push-notifications/fcm-credentials/),
[Expo build Android cục bộ](https://docs.expo.dev/guides/local-app-development/),
[Firebase Android setup](https://firebase.google.com/docs/cloud-messaging/android/get-started).
