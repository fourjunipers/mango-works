# Thai lines to review: products, stage A (13 Nov 2026)

**Question for Korn (Phase 2, stage 6, 17 Nov 2026):** "สูงสุดต่อคัน uses คัน (land vehicles); boats use ลำ. Keep คัน or use neutral wording (e.g. สูงสุดต่อยานพาหนะ)?" The strings are not changed until you answer: `Products.extras.most`, `mostCount`, `mostNone`, `mostHelp` and the History lines in the stage 6 table below.

New or changed Thai texts in `apps/platform/messages/th.json` on the branch `platform/products-stage-a`. They are Claude's translations and need a native check by Korn or BSR's admin. Correct them in `th.json` (the key is in the first column); this file can be deleted once they are approved.

**The word for "product" is สินค้า, provisional** (owner, 13 Nov 2026). It is used for things that are rented, not only sold. If another word is chosen, it is one find-and-replace of สินค้า in `th.json`; the lines that use it are all in this list or in `docs/platform/thai-review-fleet-rework.md`.

"Vehicle" stays รถ (counted in คัน) for a vehicle unit, as before. The Fleet menu entry stays รถทั้งหมด.


**Second round (13 Nov 2026, after the owner's click-through).** The create form is a kind and a product name; the make-and-model type-ahead and its texts are gone (`Fleet.what.makeModel*`, `suggestions`, `filled*`, `notKnown`, `makeHelp`, `optional`, `tip.fromList`, `tip.typed`, `Fleet.model.nameHelpNew`, `FormErrors.inPresets`, `FormErrors.requiredSpecs`, and earlier `Fleet.what.typeIt`, `useList`, `notInList`). New or changed in this round: `Fleet.what.kindLegend`, `Fleet.what.tip.text`, `Fleet.category.dirt_bike` (Dirt bike, รถวิบาก: for approval), `Fleet.model.detailsTitle`, `name`, `namePlaceholder`, `nameHelp`, `Fleet.motoMangos.submitHelp`, `categoryFirst`, `FormErrors.specs_required`.

**Third round (13 Nov 2026).** Make and model are gone from the platform's screens; the Moto Mangos panel has a new order and new texts; buffers are in hours; Fleet is one line per product. New or changed in this round: `Fleet.list`, `vehicleCounts`, `searchPlaceholder`, `Fleet.unit.modelYear` (now "Year", ปี), `modelYearHelp`, `Fleet.model.removeTitle`, `namePlaceholder`, `nameHelp`, `bufferBefore`, `bufferAfter`, `bufferHelp`, `modesHelp`, `Products.duplicate`, `Products.searchPlaceholder`, `FormErrors.invalidHours`, `specs_required`, `Fleet.motoMangos.selectFromList`, `notInList`, `submitHelp`, `submit`, `bikeYear`, `bikeYearHelp`, `listingTitle`, `listingLocked`, `list`, `Fleet.what.tip.text`, `Fleet.import.columnsHelp`, and `Admin.years`, `yearFrom`, `yearTo`, `yearsHelp` (the Moto Mangos admin page). Gone: the make, model, engine-size and transmission labels and filters, the group-by and sort texts, "Did you mean", the year range on the shop's review form.

**Fourth round (13 Nov 2026).** New or changed: `Fleet.editModel` (the pencil: "Edit product"), `Fleet.motoMangos.useChosen` ("Select"), `quantitiesTitle`, `instantHelp`, `requestHelp`, `walkinsHelp`, `Fleet.model.readyNow` (now "Walk-ins"), `Fleet.model.deleteBlocked` and `FormErrors.productHasVehicles` (the same sentence), `Fleet.model.removeTitle`. Gone: `Fleet.model.modesHelp`, `retire`, `retireConfirm`, `Fleet.motoMangos.bikesOnly`, `Products.open`.

| Key | English | Thai |
| --- | --- | --- |
| `Nav.products` | Products | สินค้า |
| `Products.title` | Products | สินค้า |
| `Products.intro` | {count, plural, =0 {No products yet} one {# product} other {# products}}: what you rent out. Each vehicle you own sits under its product. | {count, plural, =0 {ยังไม่มีสินค้า} other {สินค้า # รายการ}}: สิ่งที่ร้านให้เช่า รถแต่ละคันของร้านอยู่ภายใต้สินค้าของมัน |
| `Products.new` | New product | สินค้าใหม่ |
| `Products.empty` | Nothing here yet. Start with “New product”, then add your vehicles to it, or import them all from a CSV file on the Fleet page. | ยังไม่มีสินค้า เริ่มที่ “สินค้าใหม่” แล้วเพิ่มรถของร้านไว้ใต้สินค้านั้น หรือนำเข้าทั้งหมดจากไฟล์ CSV ที่หน้ารถทั้งหมด |
| `Products.searchLabel` | Find a product | ค้นหาสินค้า |
| `Products.show` | Show | แสดง |
| `Products.scope.current` | In use | ใช้งานอยู่ |
| `Products.scope.retired` | Retired | ปลดระวาง |
| `Products.scope.all` | Everything | ทั้งหมด |
| `Products.motoMangos` | Moto Mangos | Moto Mangos |
| `Products.list` | Products | รายการสินค้า |
| `Products.noMatch` | No product matches. Change the search or the filters. | ไม่พบสินค้าที่ตรงกัน ลองเปลี่ยนคำค้นหาหรือตัวกรอง |
| `Products.showing` | Showing {shown} of {total} | แสดง {shown} จาก {total} |
| `Products.type.vehicle` | Vehicle | ยานพาหนะ |
| `Products.type.gear` | Rental gear | อุปกรณ์ให้เช่า |
| `Products.type.sale_item` | Item for sale | สินค้าสำหรับขาย |
| `Products.type.service` | Service | บริการ |
| `Products.stock` | {count, plural, =0 {No vehicles in the fleet} one {# vehicle in the fleet} other {# vehicles in the fleet}} | {count, plural, =0 {ไม่มีรถในฟลีต} other {รถในฟลีต # คัน}} |
| `Products.stockPast` | {count} sold or retired | ขายแล้วหรือปลดระวาง {count} คัน |
| `Products.tabs.label` | Sections of this product | ส่วนต่าง ๆ ของสินค้านี้ |
| `Products.tabs.details` | Details | รายละเอียด |
| `Products.tabs.units` | Units | รถของสินค้านี้ |
| `Products.tabs.history` | History | ประวัติ |
| `Products.added` | Product saved. Add its vehicles on the Units tab. | บันทึกสินค้าแล้ว เพิ่มรถของสินค้านี้ได้ที่แท็บรถของสินค้านี้ |
| `Products.readOnly` | You can view this product but not change it. | คุณดูสินค้านี้ได้ แต่แก้ไขไม่ได้ |
| `Products.seeInFleet` | See these vehicles in Fleet | ดูรถเหล่านี้ในหน้ารถทั้งหมด |
| `Products.history.intro` | Who changed what on this product and its vehicles, newest first. | ใครเปลี่ยนอะไรในสินค้านี้และรถของสินค้านี้ เรียงจากล่าสุด |
| `Products.history.none` | No changes recorded yet. | ยังไม่มีการเปลี่ยนแปลงที่บันทึกไว้ |
| `Products.history.latest` | Showing the latest {count} changes. | แสดงการเปลี่ยนแปลงล่าสุด {count} รายการ |
| `Products.history.system` | The system | ระบบ |
| `Products.history.formerMember` | Someone no longer in the team | ผู้ที่ไม่ได้อยู่ในทีมแล้ว |
| `Products.history.on.products` | this product | สินค้านี้ |
| `Products.history.on.units` | vehicle {name} | รถ {name} |
| `Products.history.on.product_year_bands` | a year band | ช่วงปีรุ่น |
| `Products.history.action.insert` | {who} added {what} | {who} เพิ่ม{what} |
| `Products.history.action.update` | {who} changed {what} | {who} แก้ไข{what} |
| `Products.history.action.delete` | {who} deleted {what} | {who} ลบ{what} |
| `Products.history.action.clamp_booking_counts` | Booking counts were lowered on {what} because a vehicle left the fleet | จำนวนรถที่เปิดจองของ{what}ถูกปรับลด เพราะมีรถออกจากฟลีต |
| `Products.history.action.other` | {who}: {action} on {what} | {who}: {action} ที่{what} |
| `Products.history.change` | {field}: {from} → {to} | {field}: {from} → {to} |
| `Products.history.empty` | (empty) | (ว่าง) |
| `Products.history.yes` | yes | ใช่ |
| `Products.history.no` | no | ไม่ |
| `Products.history.field.name` | Name | ชื่อ |
| `Products.history.field.description` | Description | คำอธิบาย |
| `Products.history.field.categories` | Categories | หมวดหมู่ |
| `Products.history.field.deposit` | Deposit (minor units) | เงินมัดจำ (หน่วยย่อย) |
| `Products.history.field.bookable_online` | Can be booked online | จองออนไลน์ได้ |
| `Products.history.field.marketplace_listed` | Listed on Moto Mangos | ลงประกาศบน Moto Mangos |
| `Products.history.field.instant_units` | Instant units | จำนวนคันที่ยืนยันทันที |
| `Products.history.field.request_units` | Request units | จำนวนคันที่ต้องขออนุมัติ |
| `Products.history.field.ready_now` | Ready for walk-ins | พร้อมสำหรับลูกค้าหน้าร้าน |
| `Products.history.field.retired_at` | Retired | ปลดระวาง |
| `Products.history.field.plate` | Plate | ทะเบียน |
| `Products.history.field.status` | Status | สถานะ |
| `Products.history.field.current_odometer_km` | Odometer (km) | เลขไมล์ (กม.) |
| `Products.history.field.colour` | Colour | สี |
| `Products.history.field.model_year` | Model year | ปีรุ่น |
| `Products.history.field.notes` | Notes | หมายเหตุ |
| `Fleet.intro` | {units, plural, =0 {No vehicles yet} one {# vehicle} other {# vehicles}} in {models, plural, one {# product} other {# products}}. | {units, plural, =0 {ยังไม่มีรถ} other {รถ # คัน}} ใน {models, plural, other {สินค้า # รายการ}} |
| `Fleet.empty` | No vehicles yet. Add a product on the Products page, then add your vehicles to it, or import them all from a CSV file. | ยังไม่มีรถ เพิ่มสินค้าที่หน้าสินค้า แล้วเพิ่มรถของร้านไว้ใต้สินค้านั้น หรือนำเข้าทั้งหมดจากไฟล์ CSV |
| `Fleet.addUnit` | Add vehicle | เพิ่มรถ |
| `Fleet.addUnitRow` | Add vehicle | เพิ่มรถ |
| `Fleet.noUnits` | No vehicles of this product yet. | ยังไม่มีรถของสินค้านี้ |
| `Fleet.model.newTitle` | New product | สินค้าใหม่ |
| `Fleet.model.editTitle` | Product | สินค้า |
| `Fleet.model.units` | Vehicles of this product | รถของสินค้านี้ |
| `Fleet.model.delete` | Delete product | ลบสินค้า |
| `Fleet.model.deleteConfirm` | Delete this product? This can't be undone. | ลบสินค้านี้หรือไม่? ไม่สามารถย้อนกลับได้ |
| `Fleet.model.newIntro` | Something you rent out, like a Honda Click 160. Add the vehicles themselves afterwards, on the product's Units tab. | สิ่งที่ร้านให้เช่า เช่น Honda Click 160 จากนั้นเพิ่มรถแต่ละคันที่แท็บรถของสินค้านี้ |
| `Fleet.model.saveNew` | Save product | บันทึกสินค้า |
| `Fleet.model.retiredOn` | Retired on {date}. It is hidden from the Products and Fleet lists and from “Add vehicle”, and is not listed on Moto Mangos. Find it under Show: Retired. | ปลดระวางเมื่อ {date} ถูกซ่อนจากรายการสินค้า รายการรถ และจาก “เพิ่มรถ” และไม่ได้ลงประกาศบน Moto Mangos ดูได้ที่ แสดง: ปลดระวาง |
| `Fleet.model.restore` | Restore product | นำสินค้ากลับมาใช้ |
| `Fleet.model.deleteConfirmWaiting` | Delete this product? This can't be undone. Its Moto Mangos review request will be withdrawn. | ลบสินค้านี้หรือไม่ การลบไม่สามารถย้อนกลับได้ คำขอตรวจกับ Moto Mangos จะถูกถอน |
| `Fleet.unit.newTitle` | Add vehicle | เพิ่มรถ |
| `Fleet.unit.model` | Product | สินค้า |
| `Fleet.unit.makeOrModelMissing` | Product not here? Add it first | ไม่มีสินค้าที่ต้องการ? เพิ่มก่อน |
| `Fleet.unit.newIntro` | One vehicle of a product you already have. | รถหนึ่งคันของสินค้าที่ร้านมีอยู่แล้ว |
| `Fleet.unit.modelHelp` | Only your own products are listed. | แสดงเฉพาะสินค้าของร้าน |
| `Fleet.unit.noModelsYet` | Add a product first. Then come back to add the vehicles you have of it. | เพิ่มสินค้าก่อน แล้วกลับมาเพิ่มรถที่ร้านมี |
| `Fleet.import.done` | Imported {units, plural, one {# vehicle} other {# vehicles}} and {products, plural, =0 {no new products} one {# new product} other {# new products}}. | นำเข้า {units, plural, other {รถ # คัน}} และ {products, plural, =0 {ไม่มีสินค้าใหม่} other {สินค้าใหม่ # รายการ}} |
| `FormErrors.model_retired` | This product is retired. Restore it first. | สินค้านี้ปลดระวางแล้ว กรุณานำกลับมาใช้ก่อน |
| `FormErrors.model_has_active_units` | Retire or sell its vehicles first. A product can be retired once none of its vehicles is in the fleet. | ปลดระวางหรือขายรถของสินค้านี้ก่อน สินค้าจะปลดระวางได้เมื่อไม่มีรถคันใดอยู่ในฟลีตแล้ว |
| `FormErrors.ownModelExists` | You already have a product with this make and model. | ร้านมีสินค้ายี่ห้อและรุ่นนี้อยู่แล้ว |
| `Fleet.view.group.model` | Product | สินค้า |
| `Fleet.bands.intro` | How the Fleet list splits this product by model year. With none, it shows one group for all years. | วิธีที่หน้ารถทั้งหมดแบ่งสินค้านี้ตามปีของรุ่น หากไม่มี จะแสดงกลุ่มเดียวสำหรับทุกปี |
| `Fleet.what.kindLegend` | What kind of product is it? | สินค้านี้เป็นประเภทใด |
| `Fleet.category.dirt_bike` | Dirt bike | รถวิบาก |
| `Fleet.model.detailsTitle` | Product details | รายละเอียดสินค้า |
| `Fleet.model.name` | Product name | ชื่อสินค้า |
| `Fleet.motoMangos.categoryFirst` | Choose a category for this product on the Details tab, save, and then you can send it to Moto Mangos. | เลือกหมวดหมู่ของสินค้านี้ที่แท็บรายละเอียด บันทึก แล้วจึงส่งให้ Moto Mangos ได้ |
| `Fleet.list` | Vehicles by product | รถตามสินค้า |
| `Fleet.vehicleCounts` | {vehicles, plural, =0 {No vehicles} one {# vehicle} other {# vehicles}} · {available} available | {vehicles, plural, =0 {ไม่มีรถ} other {รถ # คัน}} · พร้อมใช้ {available} คัน |
| `Fleet.searchPlaceholder` | Product name, plate or frame number | ชื่อสินค้า ทะเบียน หรือเลขตัวถัง |
| `Fleet.unit.modelYear` | Year | ปี |
| `Fleet.unit.modelYearHelp` | The year of this vehicle. | ปีของรถคันนี้ |
| `Fleet.model.namePlaceholder` | e.g. Honda CB500X 2022-2024 | เช่น Honda CB500X 2022-2024 |
| `Fleet.model.nameHelp` | What you call it. Put the make, model and years in the name if you want them. No two products can have the same name. | ชื่อที่ร้านใช้เรียก ใส่ยี่ห้อ รุ่น และปีไว้ในชื่อได้หากต้องการ สินค้าสองรายการใช้ชื่อเดียวกันไม่ได้ |
| `Fleet.model.bufferBefore` | Buffer before pickup (hours) | เวลาเผื่อก่อนรับรถ (ชั่วโมง) |
| `Fleet.model.bufferAfter` | Buffer after return (hours) | เวลาเผื่อหลังคืนรถ (ชั่วโมง) |
| `Fleet.model.bufferHelp` | Decimals are fine: 0.5 is half an hour. Blank uses the shop default (set in Phase 2). | ใส่ทศนิยมได้ เช่น 0.5 คือครึ่งชั่วโมง เว้นว่างเพื่อใช้ค่าเริ่มต้นของร้าน (ตั้งค่าในเฟส 2) |
| `Products.duplicate` | Duplicate | ทำสำเนา |
| `Products.searchPlaceholder` | Product name | ชื่อสินค้า |
| `FormErrors.invalidHours` | Enter the hours as a number, like 2 or 0.5 (168 at most). | กรอกจำนวนชั่วโมงเป็นตัวเลข เช่น 2 หรือ 0.5 (ไม่เกิน 168) |
| `FormErrors.specs_required` | Give the make, model, engine size, transmission and year first. | กรุณาระบุยี่ห้อ รุ่น ขนาดเครื่องยนต์ ระบบเกียร์ และปีก่อน |
| `Fleet.motoMangos.selectFromList` | Select your make and model from the list | เลือกยี่ห้อและรุ่นของคุณจากรายการ |
| `Fleet.motoMangos.notInList` | Don’t see your bike above? Send us the details and we’ll get it added | ไม่เห็นรถของคุณด้านบน? ส่งรายละเอียดมาให้เรา แล้วเราจะเพิ่มให้ |
| `Fleet.motoMangos.submitHelp` | Give its make, model, engine size, transmission and year: all five are needed. We review it first because it is new to our list. | ระบุยี่ห้อ รุ่น ขนาดเครื่องยนต์ ระบบเกียร์ และปี ต้องมีครบทั้งห้าอย่าง เราจะตรวจก่อนเพราะยังไม่อยู่ในรายการของเรา |
| `Fleet.motoMangos.submit` | Send for review | ส่งให้ตรวจ |
| `Fleet.motoMangos.bikeYear` | Year of your bike | ปีของรถคุณ |
| `Fleet.motoMangos.bikeYearHelp` | One year, like 2023. | ปีเดียว เช่น 2023 |
| `Fleet.motoMangos.listingTitle` | Listing | การลงประกาศ |
| `Fleet.motoMangos.listingLocked` | You can switch this on once a model is selected from the list above, or your request is approved. | เปิดใช้ได้เมื่อเลือกรุ่นจากรายการด้านบนแล้ว หรือเมื่อคำขอของคุณได้รับอนุมัติ |
| `Fleet.motoMangos.list` | List this product on Moto Mangos | ลงประกาศสินค้านี้บน Moto Mangos |
| `Fleet.what.tip.text` | To put this vehicle on the Moto Mangos marketplace, save it first. Then, on its product page, select its make and model from the Moto Mangos list or send us its details. | หากต้องการลงรถคันนี้ในตลาด Moto Mangos ให้บันทึกก่อน จากนั้นที่หน้าสินค้า ให้เลือกยี่ห้อและรุ่นจากรายการของ Moto Mangos หรือส่งรายละเอียดมาให้เรา |
| `Fleet.import.columnsHelp` | “product” is required: the product’s name, as it is on your Products page. A name you don’t have yet creates the product: give “vehicle_type” (motorbike, car, atv, boat or other; blank means motorbike) and “category” (the choices are under Categories below; required for a motorbike or a car; for several, separate them with a semicolon, like “adventure; touring”). There is no make, model, engine size or transmission column: put the make, model and years in the product’s name or description if you want them. “year” is the vehicle’s own year. Leave “plate” blank for a vehicle without one yet. Dates are YYYY-MM-DD; odometer is in {unit}; purchase price is in {currency}. | ต้องมี “product”: ชื่อสินค้าตามที่อยู่ในหน้าสินค้าของร้าน ชื่อที่ร้านยังไม่มีจะสร้างสินค้าใหม่: ระบุ “vehicle_type” (motorbike, car, atv, boat หรือ other เว้นว่างหมายถึง motorbike) และ “category” (ตัวเลือกอยู่ใต้หัวข้อ หมวด ด้านล่าง บังคับสำหรับมอเตอร์ไซค์และรถยนต์ หากมีหลายหมวดให้คั่นด้วยเครื่องหมาย ; เช่น “adventure; touring”) ไม่มีคอลัมน์ยี่ห้อ รุ่น ขนาดเครื่องยนต์ หรือระบบเกียร์: ใส่ยี่ห้อ รุ่น และปีไว้ในชื่อหรือคำอธิบายของสินค้าได้หากต้องการ “year” คือปีของรถคันนั้น เว้น “plate” ว่างสำหรับรถที่ยังไม่มีทะเบียน วันที่เป็น YYYY-MM-DD เลขไมล์เป็น {unit} ราคาซื้อเป็น {currency} |
| `Admin.years` | Model years this entry covers | ปีรุ่นที่รายการนี้ครอบคลุม |
| `Admin.yearFrom` | First model year | ปีรุ่นแรก |
| `Admin.yearTo` | Last model year | ปีรุ่นสุดท้าย |
| `Admin.yearsHelp` | The shop’s own bike is a {year}. Set the range of years before you approve. | รถของร้านเป็นปี {year} กำหนดช่วงปีก่อนอนุมัติ |
| `Fleet.editModel` | Edit product | แก้ไขสินค้า |
| `Fleet.motoMangos.useChosen` | Select | เลือก |
| `Fleet.motoMangos.quantitiesTitle` | Set bike quantities per booking type | กำหนดจำนวนรถตามประเภทการจอง |
| `Fleet.motoMangos.instantHelp` | Future bookings that receive instant approval | การจองล่วงหน้าที่ได้รับการอนุมัติทันที |
| `Fleet.motoMangos.requestHelp` | Future bookings that require your approval | การจองล่วงหน้าที่ต้องรอร้านอนุมัติ |
| `Fleet.motoMangos.walkinsHelp` | Bookings that are ready for immediate pickup today (overrides the lead time) | การจองที่พร้อมรับรถได้ทันทีในวันนี้ (ไม่ใช้เวลาจองล่วงหน้า) |
| `Fleet.model.readyNow` | Walk-ins | ลูกค้าหน้าร้าน |
| `Fleet.model.deleteBlocked` | This product still has vehicles. Remove all its vehicles first. | สินค้านี้ยังมีรถอยู่ กรุณานำรถทั้งหมดออกก่อน |
| `FormErrors.productHasVehicles` | This product still has vehicles. Remove all its vehicles first. | สินค้านี้ยังมีรถอยู่ กรุณานำรถทั้งหมดออกก่อน |
| `Fleet.model.removeTitle` | Delete this product | ลบสินค้านี้ |

## Stage B: general products (13 Nov 2026)

New Thai texts on the branch `platform/products-stage-b`: the two-choice start of "New product", the General form, the list tabs, the Stock tab, the manual order, "Change model" and "Disconnect", and their error messages. Claude's translations again, for the same native check. One existing line changed: `Products.type.service` was "Service" (บริการ) and is now "Service or extra" (บริการหรือบริการเสริม).

Words to look at first, because many lines use them:

| English | Thai used | Note |
| --- | --- | --- |
| General (the tab and the choice) | ทั่วไป | Everything that is not a vehicle |
| unit, of gear | ชิ้น | A vehicle stays คัน |
| in stock | มีในสต็อก | |
| damaged | ชำรุด | Out of use for cleaning or repair |
| lost | สูญหาย | |
| label, on a unit | ป้ายชื่อ | "GoPro 3" |
| Disconnect (from Moto Mangos) | ยกเลิกการเชื่อมต่อ | |
| Change model | เปลี่ยนรุ่น | |

| Key | English | Thai |
| --- | --- | --- |
| `Products.tab.label` | Which products | กลุ่มสินค้า |
| `Products.tab.all` | All | ทั้งหมด |
| `Products.tab.vehicles` | Vehicles | ยานพาหนะ |
| `Products.tab.general` | General | ทั่วไป |
| `Products.type.service` | Service or extra | บริการหรือบริการเสริม |
| `Products.inStock` | {inStock} in stock | มีในสต็อก {inStock} |
| `Products.inStockLost` | {inStock} in stock, {lost} lost | มีในสต็อก {inStock} สูญหาย {lost} |
| `Products.noStock` | No stock: it is a service | ไม่มีสต็อก: เป็นบริการ |
| `Products.addedGeneral` | Product saved. | บันทึกสินค้าแล้ว |
| `Products.delete` | Delete product | ลบสินค้า |
| `Products.deleteTitle` | Delete this product | ลบสินค้านี้ |
| `Products.deleteConfirm` | Delete this product? This can't be undone. | ลบสินค้านี้หรือไม่? ไม่สามารถย้อนกลับได้ |
| `Products.tabs.stock` | Stock | สต็อก |
| `Products.order.up` | Move up | เลื่อนขึ้น |
| `Products.order.down` | Move down | เลื่อนลง |
| `Products.order.reset` | Reset to A–Z | รีเซ็ตเป็น A–Z |
| `Products.order.resetConfirm` | Reset to A–Z? Your own order of products is cleared, on Fleet and on the Products list. | รีเซ็ตเป็น A–Z หรือไม่? ลำดับสินค้าที่ร้านจัดไว้จะถูกล้าง ทั้งในหน้ารถทั้งหมดและหน้าสินค้า |
| `Products.order.custom` | Shown in your own order. | แสดงตามลำดับที่ร้านจัดไว้ |
| `Products.order.filtered` | Clear the search and filters to change the order. | ล้างคำค้นหาและตัวกรองก่อน จึงจะเปลี่ยนลำดับได้ |
| `Products.choice.legend` | What are you adding? | คุณกำลังเพิ่มอะไร? |
| `Products.choice.vehicle` | Vehicle | ยานพาหนะ |
| `Products.choice.vehicleHelp` | A motorbike, car, boat or anything else with its own plate and records. | มอเตอร์ไซค์ รถยนต์ เรือ หรือสิ่งอื่นที่มีทะเบียนและประวัติของตัวเอง |
| `Products.choice.general` | General | ทั่วไป |
| `Products.choice.generalHelp` | Rental gear, items for sale, services and extras. | อุปกรณ์ให้เช่า สินค้าสำหรับขาย บริการและบริการเสริม |
| `Products.general.typeLegend` | What type of product is it? | สินค้านี้เป็นประเภทใด? |
| `Products.general.typeHelp.gear` | Lent out and returned: helmets, cameras, phone holders. | ให้ยืมแล้วรับคืน: หมวกกันน็อก กล้อง ที่ยึดโทรศัพท์ |
| `Products.general.typeHelp.sale_item` | Sold, not returned: stickers, shirts, hats. | ขายขาด ไม่รับคืน: สติกเกอร์ เสื้อ หมวก |
| `Products.general.typeHelp.service` | Charged for, with no stock: cover, delivery, licence help. | คิดค่าบริการ ไม่มีสต็อก: ความคุ้มครอง การส่งรถ การช่วยเรื่องใบขับขี่ |
| `Products.general.name` | Product name | ชื่อสินค้า |
| `Products.general.nameHelp` | One product per size for now: add Helmet S, Helmet M and Helmet L as three products. | ตอนนี้ใช้หนึ่งสินค้าต่อหนึ่งขนาด: เพิ่มหมวก S หมวก M และหมวก L เป็นสามสินค้า |
| `Products.general.namePlaceholder` | e.g. Helmet M | เช่น หมวกกันน็อก M |
| `Products.general.description` | Description | คำอธิบาย |
| `Products.general.trackUnits` | Track each unit on its own | ติดตามแยกทีละชิ้น |
| `Products.general.trackUnitsHelp` | Each unit gets its own line, and a label if you want one. Leave it off to count them only. | แต่ละชิ้นมีบรรทัดของตัวเอง และตั้งป้ายชื่อได้หากต้องการ ไม่ต้องเลือกหากต้องการนับจำนวนอย่างเดียว |
| `Products.general.quantity` | Quantity | จำนวน |
| `Products.general.quantityAt` | Quantity at {location} | จำนวนที่ {location} |
| `Products.general.quantityHelp` | How many you have. You can change it later on the Stock tab. | จำนวนที่ร้านมี เปลี่ยนได้ภายหลังที่แท็บสต็อก |
| `Products.general.serviceNote` | A service has no quantity: it is always available. | บริการไม่มีจำนวน: พร้อมให้บริการเสมอ |
| `Products.general.pricesLater` | Prices come in a later stage, and selling items comes with orders. | ราคาจะมาในขั้นถัดไป และการขายสินค้าจะมาพร้อมระบบออเดอร์ |
| `Products.general.save` | Add product | เพิ่มสินค้า |
| `Products.stockTab.counts` | Stock at this location | สต็อกที่สาขานี้ |
| `Products.stockTab.inStock` | {count} in stock | มีในสต็อก {count} |
| `Products.stockTab.available` | {count} available now | พร้อมใช้ตอนนี้ {count} |
| `Products.stockTab.damaged` | {count} damaged | ชำรุด {count} |
| `Products.stockTab.lost` | {count} lost | สูญหาย {count} |
| `Products.stockTab.onHand` | {count} on hand | มีอยู่ {count} |
| `Products.stockTab.quantity` | Quantity | จำนวน |
| `Products.stockTab.quantityHelpGear` | Raising it adds units. Lowering it removes units that are free. | เพิ่มจำนวนคือเพิ่มชิ้น ลดจำนวนคือนำชิ้นที่ว่างออก |
| `Products.stockTab.quantityHelpSale` | What you have on hand now. The change is kept in the stock history. | จำนวนที่มีอยู่ตอนนี้ การเปลี่ยนแปลงจะถูกเก็บไว้ในประวัติสต็อก |
| `Products.stockTab.changeQuantity` | Change quantity | เปลี่ยนจำนวน |
| `Products.stockTab.markDamaged` | Mark damaged | ทำเครื่องหมายว่าชำรุด |
| `Products.stockTab.damagedHowMany` | How many are damaged | ชำรุดกี่ชิ้น |
| `Products.stockTab.until` | Back in use on (optional) | กลับมาใช้ได้เมื่อ (ไม่บังคับ) |
| `Products.stockTab.untilHelp` | Leave blank if you don’t know yet. Time zone: {zone}. | เว้นว่างได้หากยังไม่ทราบ เขตเวลา: {zone} |
| `Products.stockTab.backInUse` | Back in use | กลับมาใช้ได้ |
| `Products.stockTab.repairedHowMany` | How many are back in use | กลับมาใช้ได้กี่ชิ้น |
| `Products.stockTab.markLost` | Mark lost | ทำเครื่องหมายว่าสูญหาย |
| `Products.stockTab.lostHowMany` | How many are lost | สูญหายกี่ชิ้น |
| `Products.stockTab.units` | Units | รายชิ้น |
| `Products.stockTab.unit` | Unit {number} | ชิ้นที่ {number} |
| `Products.stockTab.noUnits` | No units here yet. Set the quantity to add some. | ยังไม่มีชิ้นที่นี่ ตั้งจำนวนเพื่อเพิ่ม |
| `Products.stockTab.label` | Label (optional) | ป้ายชื่อ (ไม่บังคับ) |
| `Products.stockTab.labelPlaceholder` | e.g. GoPro 3 | เช่น GoPro 3 |
| `Products.stockTab.saveLabel` | Save label | บันทึกป้ายชื่อ |
| `Products.stockTab.status.damaged` | Damaged | ชำรุด |
| `Products.stockTab.status.lost` | Lost | สูญหาย |
| `Products.stockTab.ledger` | Stock history | ประวัติสต็อก |
| `Products.stockTab.ledgerIntro` | Every change to what is on hand, newest first. | ทุกการเปลี่ยนแปลงของจำนวนที่มีอยู่ เรียงจากล่าสุด |
| `Products.stockTab.ledgerNone` | No stock recorded yet. | ยังไม่มีการบันทึกสต็อก |
| `Products.stockTab.kind.received` | Received | รับเข้า |
| `Products.stockTab.kind.adjusted` | Adjusted | ปรับยอด |
| `Products.stockTab.kind.sold` | Sold | ขาย |
| `Products.stockTab.kind.returned` | Returned | รับคืน |
| `Products.stockTab.serviceNote` | A service has no stock: it is always available. | บริการไม่มีสต็อก: พร้อมให้บริการเสมอ |
| `Products.history.introGeneral` | Who changed what on this product, newest first. | ใครเปลี่ยนอะไรในสินค้านี้ เรียงจากล่าสุด |
| `Products.history.unlabelled` | without a label | ไม่มีป้ายชื่อ |
| `Products.history.on.gearUnits` | unit {name} | ชิ้น {name} |
| `Products.history.action.stock_adjust` | {who} changed the quantity of {what} | {who} เปลี่ยนจำนวนของ{what} |
| `Products.history.action.units_damaged` | {who} marked {count} damaged on {what} | {who} ทำเครื่องหมายว่าชำรุด {count} ชิ้นใน{what} |
| `Products.history.action.units_repaired` | {who} put {count} back in use on {what} | {who} นำ {count} ชิ้นกลับมาใช้ใน{what} |
| `Products.history.action.units_lost` | {who} marked {count} lost on {what} | {who} ทำเครื่องหมายว่าสูญหาย {count} ชิ้นใน{what} |
| `Products.history.action.listing_change_model` | {who} moved {what} to another Moto Mangos list entry | {who} ย้าย{what}ไปยังรายการอื่นของ Moto Mangos |
| `Products.history.action.listing_disconnect` | {who} disconnected {what} from Moto Mangos | {who} ยกเลิกการเชื่อมต่อ{what}กับ Moto Mangos |
| `Products.history.field.quantity` | Quantity | จำนวน |
| `Products.history.field.label` | Label | ป้ายชื่อ |
| `Fleet.status.lost` | Lost | สูญหาย |
| `Fleet.motoMangos.changeModel` | Change model | เปลี่ยนรุ่น |
| `Fleet.motoMangos.changeModelHelp` | Pick the make and model this product should be listed as. Your listing and its quantities stay as they are. | เลือกยี่ห้อและรุ่นที่ต้องการให้สินค้านี้ลงประกาศ การลงประกาศและจำนวนของคุณยังคงเดิม |
| `Fleet.motoMangos.changeModelLegend` | Select the new make and model | เลือกยี่ห้อและรุ่นใหม่ |
| `Fleet.motoMangos.disconnect` | Disconnect | ยกเลิกการเชื่อมต่อ |
| `Fleet.motoMangos.disconnectHelp` | Takes this product off Moto Mangos: the listing is switched off and its place on the list is cleared. | นำสินค้านี้ออกจาก Moto Mangos: ปิดการลงประกาศและล้างรายการที่เชื่อมไว้ |
| `Fleet.motoMangos.disconnectConfirm` | Disconnect this product from Moto Mangos? Its listing is switched off and its list entry is cleared. Bookings already made stay as they are. | ยกเลิกการเชื่อมต่อสินค้านี้กับ Moto Mangos หรือไม่? การลงประกาศจะถูกปิดและรายการที่เชื่อมไว้จะถูกล้าง การจองที่มีอยู่แล้วยังคงเดิม |
| `Fleet.motoMangos.upcomingBookings` | {count, plural, one {# upcoming booking on this product’s vehicles stays} other {# upcoming bookings on this product’s vehicles stay}} exactly as booked if you change the model or disconnect. | {count, plural, other {การจองที่กำลังจะมาถึง # รายการของรถในสินค้านี้}}จะยังคงเดิมทุกอย่าง แม้คุณเปลี่ยนรุ่นหรือยกเลิกการเชื่อมต่อ |
| `FormErrors.invalidQuantity` | Enter a whole number. | กรอกจำนวนเต็ม |
| `FormErrors.units_blocked` | {count, plural, one {# unit is} other {# units are}} damaged or booked, so the quantity can’t go below {count}. | {count, plural, other {มี # ชิ้น}}ที่ชำรุดหรือถูกจองอยู่ จึงลดจำนวนให้ต่ำกว่า {count} ไม่ได้ |
| `FormErrors.notEnoughToLose` | Only {count} can be marked lost: the rest are booked. | ทำเครื่องหมายว่าสูญหายได้เพียง {count} ชิ้น ที่เหลือถูกจองอยู่ |
| `FormErrors.not_enough_free` | Only {count} are free to mark damaged. | มีเพียง {count} ชิ้นที่ว่างให้ทำเครื่องหมายว่าชำรุด |
| `FormErrors.not_enough_damaged` | Only {count} are damaged. | มีชำรุดเพียง {count} ชิ้น |
| `FormErrors.not_enough_lost` | Only {count} are lost. | มีสูญหายเพียง {count} ชิ้น |
| `FormErrors.quantity_out_of_range` | Enter a quantity from 0 to 1,000 (up to 100,000 for an item for sale). | กรอกจำนวนตั้งแต่ 0 ถึง 1,000 (สินค้าสำหรับขายได้ถึง 100,000) |
| `FormErrors.until_in_past` | Choose a time in the future. | เลือกเวลาในอนาคต |
| `FormErrors.label_needs_tracking` | Switch on “Track each unit on its own” first. | เปิด “ติดตามแยกทีละชิ้น” ก่อน |
| `FormErrors.tracked_units_have_records` | These units have purchase details, so they stay tracked one by one. | ชิ้นเหล่านี้มีข้อมูลการซื้อ จึงต้องติดตามแยกทีละชิ้นต่อไป |
| `FormErrors.stock_below_zero` | Stock can’t go below zero. | สต็อกต่ำกว่าศูนย์ไม่ได้ |
| `FormErrors.labelExists` | Another unit of this product already has that label. | มีชิ้นอื่นของสินค้านี้ใช้ป้ายชื่อนี้แล้ว |
| `FormErrors.not_on_list` | This product isn’t on the Moto Mangos list. | สินค้านี้ไม่ได้อยู่ในรายการของ Moto Mangos |
| `FormErrors.same_model` | It is already on that one. Choose a different one. | สินค้านี้ใช้รายการนั้นอยู่แล้ว กรุณาเลือกรายการอื่น |
| `FormErrors.request_pending` | Its request is still waiting for review. | คำขอยังรอการตรวจอยู่ |

### Stage B, second round: the Stock tab's states (14 Nov 2026)

After the owner's click-through. A unit of gear has three states, each under its own heading with one line of help: In use, Damaged, Lost. "Back in stock" became "Found, back in use" and "Remove for good" became "Write off"; History uses the same words. These lines replace the ones they changed in the table above (`Products.stockTab.restore`, `remove`, `removeConfirm`, `lostTitle`, `lostHelp` and `status.available` are gone).

| English | Thai used | Note |
| --- | --- | --- |
| In use | ใช้งานได้ | A unit that can be rented; the opposite of damaged or lost |
| Back in use | กลับมาใช้ได้ | A damaged unit that is ready again |
| Found, back in use | พบแล้ว กลับมาใช้ได้ | A lost unit that turned up |
| Write off | ตัดจำหน่าย | The accounting word for removing a lost item for good. Check it reads naturally for shop staff |

| Key | English | Thai |
| --- | --- | --- |
| `Products.stockTab.state.inUse.title` | In use ({count}) | ใช้งานได้ ({count}) |
| `Products.stockTab.state.inUse.help` | In use: available to rent. Mark a unit damaged while it is cleaned or repaired, or lost if it is missing. | ใช้งานได้: พร้อมให้เช่า ทำเครื่องหมายว่าชำรุดระหว่างทำความสะอาดหรือซ่อม หรือสูญหายหากหาไม่พบ |
| `Products.stockTab.state.damaged.title` | Damaged ({count}) | ชำรุด ({count}) |
| `Products.stockTab.state.damaged.help` | Damaged: not available to rent, but still counted in your stock. Mark it back in use when it is ready. | ชำรุด: ยังให้เช่าไม่ได้ แต่ยังนับอยู่ในสต็อก เมื่อพร้อมแล้วให้กด “กลับมาใช้ได้” |
| `Products.stockTab.state.lost.title` | Lost ({count}) | สูญหาย ({count}) |
| `Products.stockTab.state.lost.help` | Lost: not available to rent and not counted in your stock. Mark it found to put it back in use, or write it off to remove it permanently. | สูญหาย: ให้เช่าไม่ได้และไม่นับในสต็อก หากพบแล้วให้กด “พบแล้ว กลับมาใช้ได้” หรือตัดจำหน่ายเพื่อนำออกถาวร |
| `Products.stockTab.status.inUse` | In use | ใช้งานได้ |
| `Products.stockTab.found` | Found, back in use | พบแล้ว กลับมาใช้ได้ |
| `Products.stockTab.foundHowMany` | How many were found | พบแล้วกี่ชิ้น |
| `Products.stockTab.writeOff` | Write off | ตัดจำหน่าย |
| `Products.stockTab.writeOffHowMany` | How many to write off | ตัดจำหน่ายกี่ชิ้น |
| `Products.stockTab.writeOffConfirm` | Write off? This cannot be undone. The unit leaves this product’s stock counts for good and can’t be marked found again. The History keeps a record. | ตัดจำหน่ายหรือไม่? ไม่สามารถย้อนกลับได้ ชิ้นนี้จะออกจากยอดสต็อกของสินค้านี้ถาวร และทำเครื่องหมายว่าพบแล้วไม่ได้อีก ประวัติจะยังเก็บบันทึกไว้ |
| `Products.stockTab.lostConfirm` | Mark as lost? It is no longer available to rent or counted in your stock. An owner or manager can mark it found or write it off. | ทำเครื่องหมายว่าสูญหายหรือไม่? จะให้เช่าไม่ได้และไม่นับในสต็อกอีก เจ้าของหรือผู้จัดการทำเครื่องหมายว่าพบแล้วหรือตัดจำหน่ายได้ |
| `Products.stockTab.lostWaiting` | An owner or manager marks it found or writes it off. | เจ้าของหรือผู้จัดการเป็นผู้ทำเครื่องหมายว่าพบแล้วหรือตัดจำหน่าย |
| `Products.deleteBlocked` | This product still has stock. Set its quantity to 0, and mark any lost units found or write them off, first. | สินค้านี้ยังมีสต็อกอยู่ กรุณาตั้งจำนวนเป็น 0 และทำเครื่องหมายว่าพบแล้วหรือตัดจำหน่ายชิ้นที่สูญหายก่อน |
| `FormErrors.productHasStock` | This product still has stock. Set its quantity to 0, and mark any lost units found or write them off, first. | สินค้านี้ยังมีสต็อกอยู่ กรุณาตั้งจำนวนเป็น 0 และทำเครื่องหมายว่าพบแล้วหรือตัดจำหน่ายชิ้นที่สูญหายก่อน |
| `FormErrors.product_has_stock` | This product still has stock. Set its quantity to 0, and mark any lost units found or write them off, first. | สินค้านี้ยังมีสต็อกอยู่ กรุณาตั้งจำนวนเป็น 0 และทำเครื่องหมายว่าพบแล้วหรือตัดจำหน่ายชิ้นที่สูญหายก่อน |
| `Products.history.action.lost_restored` | {who} marked {count} found, back in use on {what} | {who} ทำเครื่องหมายว่าพบแล้ว กลับมาใช้ได้ {count} ชิ้นใน{what} |
| `Products.history.action.lost_removed` | {who} wrote off {count} on {what} | {who} ตัดจำหน่าย {count} ชิ้นใน{what} |
| `Products.history.action.unit_damaged` | {who} marked {what} damaged | {who} ทำเครื่องหมายว่า{what}ชำรุด |
| `Products.history.action.unit_repaired` | {who} put {what} back in use | {who} นำ{what}กลับมาใช้ได้ |
| `Products.history.action.unit_lost` | {who} marked {what} lost | {who} ทำเครื่องหมายว่า{what}สูญหาย |
| `Products.history.action.unit_found` | {who} marked {what} found, back in use | {who} ทำเครื่องหมายว่าพบ{what}แล้ว กลับมาใช้ได้ |
| `Products.history.action.unit_written_off` | {who} wrote off {what} | {who} ตัดจำหน่าย{what} |

### Rental gear, the stock rework (14 Nov 2026)

After the owner's testing of the Stock tab. The counts, "Change quantity", one "Report a problem" dialog and the "Out of service" list are on the Details tab; the Stock tab is one row per unit. "Damaged" became "In repair" for a unit that can come back; "Damaged for good" is removed from stock. Second round the same day, after the owner's click-through: "Write off" became "Remove from stock" on every button, in the confirmation and in the History; a note sits under each date ("For information only. It does not affect stock quantities."); the tracking hint names Product details and links to it. 89 new or changed texts. Claude's translations: they need a native check.

Words to look at first:

| English | Thai used | Note |
| --- | --- | --- |
| In repair | กำลังซ่อม | A unit being cleaned or repaired: still the shop's, not rentable for now. Was "Damaged" (ชำรุด) |
| Damaged for good | ชำรุดถาวร | Can't be repaired; the unit is removed |
| Remove from stock | นำออกจากสต็อก | The button that removes a unit for good, broken or lost. Was "Write off" (ตัดจำหน่าย), changed by the owner on 14 Nov 2026; ตัดจำหน่าย is no longer used anywhere |
| Out of service | งดใช้งาน | The heading over units in repair or lost. Check it reads naturally for gear, not only for vehicles |
| Report a problem | แจ้งปัญหา | The one button that opens the dialog |
| Date it happened | วันที่เกิดเหตุ | |
| Expected back | คาดว่าจะกลับมาใช้ได้ | The day a repair is expected to finish |

Gone with the old Stock tab: `Products.stockTab.counts`, `inStock`, `available`, `damaged`, `lost`, `quantityHelpGear`, `markDamaged`, `damagedHowMany`, `until`, `untilHelp`, `backInUse`, `repairedHowMany`, `markLost`, `lostHowMany`, `lostConfirm`, `lostWaiting`, `state.*`, `found`, `foundHowMany`, `writeOff`, `writeOffHowMany`, `writeOffConfirm`, `status.damaged`; and `FormErrors.notEnoughToLose`, `not_enough_damaged`, `not_enough_lost`.

| Key | English | Thai |
| --- | --- | --- |
| `Products.gearStock.detailsTitle` | Product details | รายละเอียดสินค้า |
| `Products.gearStock.summary` | Stock | สต็อก |
| `Products.gearStock.summaryHelp` | In stock counts units in use and in repair. Lost units are not counted. | “มีในสต็อก” นับชิ้นที่ใช้งานได้และชิ้นที่กำลังซ่อม ไม่นับชิ้นที่สูญหาย |
| `Products.gearStock.tile.inStock` | In stock | มีในสต็อก |
| `Products.gearStock.tile.available` | Available now | พร้อมใช้ตอนนี้ |
| `Products.gearStock.tile.inRepair` | In repair | กำลังซ่อม |
| `Products.gearStock.tile.lost` | Lost | สูญหาย |
| `Products.gearStock.quantityTitle` | Change quantity | เปลี่ยนจำนวน |
| `Products.gearStock.quantity` | Quantity | จำนวน |
| `Products.gearStock.quantityHelp` | Raising it adds units. Lowering it removes only free units, never ones in repair, lost or booked. | เพิ่มจำนวนคือเพิ่มชิ้น ลดจำนวนจะนำออกเฉพาะชิ้นที่ว่าง ไม่นำชิ้นที่กำลังซ่อม สูญหาย หรือถูกจองออก |
| `Products.gearStock.fewer` | One fewer | ลดหนึ่งชิ้น |
| `Products.gearStock.more` | One more | เพิ่มหนึ่งชิ้น |
| `Products.gearStock.saveQuantity` | Save quantity | บันทึกจำนวน |
| `Products.gearStock.reportTitle` | Report a problem | แจ้งปัญหา |
| `Products.gearStock.reportIntro` | For a unit that is in repair, lost, or damaged for good. | สำหรับชิ้นที่กำลังซ่อม สูญหาย หรือชำรุดถาวร |
| `Products.gearStock.reportButton` | Report a problem | แจ้งปัญหา |
| `Products.gearStock.reportNone` | No unit is in use and free right now, so there is nothing to report. | ตอนนี้ไม่มีชิ้นที่ใช้งานได้และว่างอยู่ จึงไม่มีอะไรให้แจ้ง |
| `Products.gearStock.what` | What happened | เกิดอะไรขึ้น |
| `Products.gearStock.kind.repair` | In repair | กำลังซ่อม |
| `Products.gearStock.kind.lost` | Lost | สูญหาย |
| `Products.gearStock.kind.damaged` | Damaged for good | ชำรุดถาวร |
| `Products.gearStock.kindHelp.repair` | Being cleaned or repaired. Still counted in stock, but not available to rent until it is back in use. | อยู่ระหว่างทำความสะอาดหรือซ่อม ยังนับอยู่ในสต็อก แต่ให้เช่าไม่ได้จนกว่าจะกลับมาใช้ได้ |
| `Products.gearStock.kindHelp.lost` | Missing. Not counted in stock and not available. It can be marked found later. | หาไม่พบ ไม่นับในสต็อกและให้เช่าไม่ได้ ทำเครื่องหมายว่าพบแล้วได้ภายหลัง |
| `Products.gearStock.kindHelp.damaged` | Can’t be repaired. Removed from this product for good. | ซ่อมไม่ได้ นำออกจากสินค้านี้ถาวร |
| `Products.gearStock.howMany` | How many | กี่ชิ้น |
| `Products.gearStock.howManyHelp` | {count} in use and free. | ใช้งานได้และว่างอยู่ {count} ชิ้น |
| `Products.gearStock.whichUnit` | Which unit | ชิ้นไหน |
| `Products.gearStock.happenedOn` | Date it happened | วันที่เกิดเหตุ |
| `Products.gearStock.expectedBack` | Expected back (optional) | คาดว่าจะกลับมาใช้ได้ (ไม่บังคับ) |
| `Products.gearStock.notes` | Notes (optional) | หมายเหตุ (ไม่บังคับ) |
| `Products.gearStock.submit.repair` | Mark in repair | ทำเครื่องหมายว่ากำลังซ่อม |
| `Products.gearStock.submit.lost` | Mark lost | ทำเครื่องหมายว่าสูญหาย |
| `Products.gearStock.submit.damaged` | Remove from stock | นำออกจากสต็อก |
| `Products.gearStock.outTitle` | Out of service | งดใช้งาน |
| `Products.gearStock.outIntro` | Units in repair or lost. Each can still come back. | ชิ้นที่กำลังซ่อมหรือสูญหาย ทุกชิ้นยังกลับมาใช้ได้ |
| `Products.gearStock.outNone` | Nothing is out of service. | ไม่มีชิ้นที่งดใช้งาน |
| `Products.gearStock.line.happenedOn` | Date it happened | วันที่เกิดเหตุ |
| `Products.gearStock.line.expectedBack` | Expected back | คาดว่าจะกลับมาใช้ได้ |
| `Products.gearStock.line.notes` | Notes | หมายเหตุ |
| `Products.gearStock.line.notSet` | Not set | ยังไม่ระบุ |
| `Products.gearStock.backInUse` | Back in use | กลับมาใช้ได้ |
| `Products.gearStock.found` | Found, back in use | พบแล้ว กลับมาใช้ได้ |
| `Products.gearStock.writeOffDamaged` | Remove from stock | นำออกจากสต็อก |
| `Products.gearStock.writeOff` | Remove from stock | นำออกจากสต็อก |
| `Products.gearStock.writeOffConfirm` | Remove from stock? This cannot be undone. The unit is removed from this product for good and can’t be marked found again. The History keeps a record. | นำออกจากสต็อกหรือไม่? ไม่สามารถย้อนกลับได้ ชิ้นนี้จะถูกนำออกจากสินค้านี้ถาวร และทำเครื่องหมายว่าพบแล้วไม่ได้อีก ประวัติจะยังเก็บบันทึกไว้ |
| `Products.gearStock.edit` | Edit | แก้ไข |
| `Products.gearStock.editTitle` | Edit details | แก้ไขรายละเอียด |
| `Products.gearStock.lostWaiting` | An owner or manager marks it found or removes it from stock. | เจ้าของหรือผู้จัดการเป็นผู้ทำเครื่องหมายว่าพบแล้วหรือนำออกจากสต็อก |
| `Products.gearStock.close` | Close | ปิด |
| `Products.gearStock.dateHelp` | For information only. It does not affect stock quantities. | เพื่อเป็นข้อมูลเท่านั้น ไม่มีผลต่อจำนวนสต็อก |
| `Products.stockTab.units` | Units ({count}) | รายชิ้น ({count}) |
| `Products.stockTab.unitsAt` | {location}: units ({count}) | {location}: รายชิ้น ({count}) |
| `Products.stockTab.noUnits` | No units here yet. Set the quantity on the Details tab to add some. | ยังไม่มีชิ้นที่นี่ ตั้งจำนวนในแท็บรายละเอียดเพื่อเพิ่ม |
| `Products.stockTab.untrackedHint` | These units are counted, not named. To give each one its own name or label, switch on “Track each unit on its own” under Product details, on the Details tab. | ชิ้นเหล่านี้นับเป็นจำนวน ไม่มีชื่อ หากต้องการตั้งชื่อหรือป้ายชื่อให้แต่ละชิ้น ให้เปิด “ติดตามแต่ละชิ้นแยกกัน” ในส่วนรายละเอียดสินค้า ที่แท็บรายละเอียด |
| `Products.stockTab.untrackedLink` | Open Product details | เปิดรายละเอียดสินค้า |
| `Products.stockTab.untrackedHintStaff` | These units are counted, not named. An owner or manager can switch on “Track each unit on its own” to give each one a name or label. | ชิ้นเหล่านี้นับเป็นจำนวน ไม่มีชื่อ เจ้าของหรือผู้จัดการเปิด “ติดตามแต่ละชิ้นแยกกัน” ได้ เพื่อตั้งชื่อหรือป้ายชื่อให้แต่ละชิ้น |
| `Products.stockTab.status.repair` | In repair | กำลังซ่อม |
| `Products.deleteBlocked` | This product still has stock. Set its quantity to 0, and mark any lost units found or remove them from stock, first. | สินค้านี้ยังมีสต็อกอยู่ กรุณาตั้งจำนวนเป็น 0 และทำเครื่องหมายว่าพบแล้วหรือนำออกจากสต็อกชิ้นที่สูญหายก่อน |
| `Products.history.action.units_damaged` | {who} marked {count} in repair on {what} | {who} ทำเครื่องหมายว่ากำลังซ่อม {count} ชิ้นใน{what} |
| `Products.history.action.units_repaired` | {who} marked {count} back in use on {what} | {who} ทำเครื่องหมายว่ากลับมาใช้ได้ {count} ชิ้นใน{what} |
| `Products.history.action.lost_removed` | {who} removed {count} from stock as lost on {what} | {who} นำ {count} ชิ้นออกจากสต็อกเนื่องจากสูญหายใน{what} |
| `Products.history.action.units_in_repair` | {who} marked {count} in repair on {what} | {who} ทำเครื่องหมายว่ากำลังซ่อม {count} ชิ้นใน{what} |
| `Products.history.action.units_back_in_use` | {who} marked {count} back in use on {what} | {who} ทำเครื่องหมายว่ากลับมาใช้ได้ {count} ชิ้นใน{what} |
| `Products.history.action.units_found` | {who} marked {count} found, back in use on {what} | {who} ทำเครื่องหมายว่าพบแล้ว กลับมาใช้ได้ {count} ชิ้นใน{what} |
| `Products.history.action.units_written_off_damaged` | {who} removed {count} from stock as damaged on {what} | {who} นำ {count} ชิ้นออกจากสต็อกเนื่องจากชำรุดใน{what} |
| `Products.history.action.units_written_off_lost` | {who} removed {count} from stock as lost on {what} | {who} นำ {count} ชิ้นออกจากสต็อกเนื่องจากสูญหายใน{what} |
| `Products.history.action.unit_problem_edit_repair` | {who} changed the details of a unit in repair on {what} | {who} แก้ไขรายละเอียดของชิ้นที่กำลังซ่อมใน{what} |
| `Products.history.action.unit_problem_edit_lost` | {who} changed the details of a lost unit on {what} | {who} แก้ไขรายละเอียดของชิ้นที่สูญหายใน{what} |
| `Products.history.action.unit_damaged` | {who} marked {what} in repair | {who} ทำเครื่องหมายว่า{what}กำลังซ่อม |
| `Products.history.action.unit_repaired` | {who} marked {what} back in use | {who} ทำเครื่องหมายว่า{what}กลับมาใช้ได้ |
| `Products.history.action.unit_written_off` | {who} removed {what} from stock as lost | {who} นำ{what}ออกจากสต็อกเนื่องจากสูญหาย |
| `Products.history.detail.units` | Unit: {names} | ชิ้น: {names} |
| `Products.history.detail.happenedOn` | Date it happened: {date} | วันที่เกิดเหตุ: {date} |
| `Products.history.detail.expectedBack` | Expected back: {date} | คาดว่าจะกลับมาใช้ได้: {date} |
| `Products.history.detail.notes` | Notes: {notes} | หมายเหตุ: {notes} |
| `Products.history.field.happened_on` | Date it happened | วันที่เกิดเหตุ |
| `Products.history.field.expected_back` | Expected back | คาดว่าจะกลับมาใช้ได้ |
| `FormErrors.units_blocked` | {count, plural, one {# unit is} other {# units are}} in repair or booked, so the quantity can’t go below {count}. | {count, plural, other {มี # ชิ้น}}ที่กำลังซ่อมหรือถูกจองอยู่ จึงลดจำนวนให้ต่ำกว่า {count} ไม่ได้ |
| `FormErrors.not_enough_free` | Only {count} in use and free. The rest are booked or already out of service. | มีเพียง {count} ชิ้นที่ใช้งานได้และว่างอยู่ ที่เหลือถูกจองหรืองดใช้งานอยู่แล้ว |
| `FormErrors.date_in_future` | Choose today or an earlier date. | เลือกวันนี้หรือวันก่อนหน้า |
| `FormErrors.expected_before_happened` | Choose the date it happened or a later one. | เลือกวันที่เกิดเหตุหรือวันหลังจากนั้น |
| `FormErrors.notes_too_long` | Keep the notes to 500 characters. | หมายเหตุยาวได้ไม่เกิน 500 ตัวอักษร |
| `FormErrors.unit_not_free` | This unit is booked or already out of service. | ชิ้นนี้ถูกจองอยู่หรืองดใช้งานอยู่แล้ว |
| `FormErrors.unit_not_found` | This unit is no longer here. Reload the page. | ไม่พบชิ้นนี้แล้ว กรุณาโหลดหน้าใหม่ |
| `FormErrors.not_in_repair` | This unit is no longer in repair. Reload the page. | ชิ้นนี้ไม่ได้กำลังซ่อมแล้ว กรุณาโหลดหน้าใหม่ |
| `FormErrors.not_lost` | This unit is no longer marked lost. Reload the page. | ชิ้นนี้ไม่ได้ถูกทำเครื่องหมายว่าสูญหายแล้ว กรุณาโหลดหน้าใหม่ |
| `FormErrors.not_out_of_service` | This unit is no longer out of service. Reload the page. | ชิ้นนี้ไม่ได้งดใช้งานแล้ว กรุณาโหลดหน้าใหม่ |
| `FormErrors.productHasStock` | This product still has stock. Set its quantity to 0, and mark any lost units found or remove them from stock, first. | สินค้านี้ยังมีสต็อกอยู่ กรุณาตั้งจำนวนเป็น 0 และทำเครื่องหมายว่าพบแล้วหรือนำออกจากสต็อกชิ้นที่สูญหายก่อน |
| `FormErrors.product_has_stock` | This product still has stock. Set its quantity to 0, and mark any lost units found or remove them from stock, first. | สินค้านี้ยังมีสต็อกอยู่ กรุณาตั้งจำนวนเป็น 0 และทำเครื่องหมายว่าพบแล้วหรือนำออกจากสต็อกชิ้นที่สูญหายก่อน |

## Fleet and Products lists on a phone (14 Nov 2026)

New texts on the branch `platform/lists-mobile-polish`: the sort, the filter chips, Reorder mode, and the names of the Moto Mangos mango (read aloud by screen readers and shown as a tooltip on desktop). Gone: `Products.order.custom` and `Products.order.filtered` (the line above the list that the Reorder button replaces), `Fleet.view.kind` and `Fleet.view.category` (the two dropdowns the chips replace), and `Fleet.modelFacts` (the tags' list name). “A–Z” stays A–Z in Thai because the names it sorts are mostly in Latin letters. “My order” is ลำดับของร้าน (“the shop’s order”), since the order belongs to the shop, not to one person.

| Key | English | Thai |
| --- | --- | --- |
| `Lists.sort.label` | Sort | เรียง |
| `Lists.sort.az` | A–Z | A–Z |
| `Lists.sort.type` | By type | ตามประเภท |
| `Lists.sort.mine` | My order | ลำดับของร้าน |
| `Lists.chips.label` | Filter by type | กรองตามประเภท |
| `Lists.chips.all` | All | ทั้งหมด |
| `Lists.reorder.start` | Reorder | จัดลำดับ |
| `Lists.reorder.done` | Done | เสร็จ |
| `Lists.reorder.help` | Move products up or down. Fleet and the Products list share this order. | เลื่อนสินค้าขึ้นหรือลง หน้ารถทั้งหมดและหน้าสินค้าใช้ลำดับเดียวกัน |
| `Lists.mango.listed` | On Moto Mangos | อยู่บน Moto Mangos |
| `Lists.mango.inReview` | In review for Moto Mangos | Moto Mangos กำลังตรวจ |
| `Lists.mango.needsChanges` | Moto Mangos needs changes | Moto Mangos ขอให้แก้ไข |
| `Lists.mango.notListed` | Not on Moto Mangos | ไม่อยู่บน Moto Mangos |

## Dragging to reorder (14 Nov 2026)

New texts on the branch `platform/drag-reorder`: the drag handle on each row in Reorder mode and what a screen reader is told while a row is dragged. Seven are new; `Lists.reorder.help` (the line above the list in Reorder mode) changed again on 15 Nov 2026 to the owner's own sentence after his phone test (no full stop at the end, as he wrote it). “Handle” is ที่จับ. `{name}` is the product's name, `{position}` and `{total}` are numbers (“position 2 of 6”). Space and Escape are the keys' names and stay in English. Most of these are heard, not seen: only `Lists.reorder.help` and `Lists.drag.handle` (a tooltip on desktop) appear on screen.

| Key | English | Thai |
| --- | --- | --- |
| `Lists.reorder.help` | Select and drag to move anywhere on the list, or use the arrows to move one row at a time | เลือกแล้วลากเพื่อย้ายไปที่ใดก็ได้ในรายการ หรือใช้ลูกศรเพื่อย้ายทีละแถว |
| `Lists.drag.handle` | Drag to move | ลากเพื่อย้าย |
| `Lists.drag.role` | sortable item | รายการที่จัดลำดับได้ |
| `Lists.drag.instructions` | Press Space to pick up. Then use the arrow keys to move it, Space to drop it, or Escape to cancel. | กด Space เพื่อหยิบ จากนั้นใช้ปุ่มลูกศรเพื่อย้าย กด Space เพื่อวาง หรือกด Escape เพื่อยกเลิก |
| `Lists.drag.pickedUp` | Picked up {name}. Position {position} of {total}. | หยิบ {name} แล้ว ตำแหน่งที่ {position} จาก {total} |
| `Lists.drag.movedTo` | {name}: position {position} of {total}. | {name}: ตำแหน่งที่ {position} จาก {total} |
| `Lists.drag.dropped` | {name} dropped at position {position} of {total}. | วาง {name} ที่ตำแหน่งที่ {position} จาก {total} |
| `Lists.drag.cancelled` | Move cancelled. {name} is back at position {position} of {total}. | ยกเลิกการย้าย {name} กลับไปที่ตำแหน่งที่ {position} จาก {total} |

## Products, stage C: the Moto Mangos tab (15 Nov 2026)

New or changed texts on the branch `platform/products-stage-c-tab`. The Moto Mangos panel moved from a motorbike's Details tab to its own tab, “Moto Mangos” (the brand name, the same in Thai). The two messages about counts are the owner's sentences; “units in your inventory” is คันในคลังของคุณ (“bikes in your stock”). The switch and “Connect” (เชื่อมต่อ, as in the existing ยกเลิกการเชื่อมต่อ for Disconnect) need a check first. “Lead time” is เวลาจองล่วงหน้า (“time to book ahead”). Thai has no plural, so the plural forms only carry the number.

**New or changed**

| Key | English | Thai |
| --- | --- | --- |
| `Products.tabs.motoMangos` | Moto Mangos | Moto Mangos |
| `Fleet.motoMangos.useChosen` | Connect | เชื่อมต่อ |
| `FormErrors.more_units_than_active` | Total units listed on Moto Mangos can not exceed the number of units in your inventory | จำนวนคันทั้งหมดที่ลงประกาศบน Moto Mangos ต้องไม่เกินจำนวนคันในคลังของคุณ |
| `FormErrors.more_walk_ins_than_active` | Walk-ins can not exceed the number of units in your inventory | จำนวนลูกค้าหน้าร้านต้องไม่เกินจำนวนคันในคลังของคุณ |
| `Fleet.motoMangos.switchOn` | On. The switch saves as soon as you press it. | เปิดอยู่ บันทึกทันทีที่กดสวิตช์ |
| `Fleet.motoMangos.switchOff` | Off. The switch saves as soon as you press it. | ปิดอยู่ บันทึกทันทีที่กดสวิตช์ |
| `Fleet.motoMangos.offering` | Offering {count} of {total, plural, one {# bike} other {# bikes}} for advance booking | เปิดให้จองล่วงหน้า {count} จาก {total, plural, other {# คัน}} |
| `Fleet.motoMangos.leadTime` | Lead time (hours) | เวลาจองล่วงหน้า (ชั่วโมง) |
| `Fleet.motoMangos.leadTimeHelp` | How many hours ahead a booking must be made, from 0 to 720. Leave it empty for none. | ต้องจองล่วงหน้ากี่ชั่วโมงก่อนรับรถ ตั้งแต่ 0 ถึง 720 เว้นว่างไว้หากไม่กำหนด |
| `FormErrors.leadTimeRange` | Enter whole hours from 0 to 720, or leave it empty. | ใส่จำนวนชั่วโมงเต็มตั้งแต่ 0 ถึง 720 หรือเว้นว่างไว้ |
| `Products.history.action.listing_on` | {who} switched Moto Mangos on | {who} เปิด Moto Mangos |
| `Products.history.action.listing_off` | {who} switched Moto Mangos off | {who} ปิด Moto Mangos |
| `Products.history.action.lead_time_change` | {who} changed lead time from {from} to {to, plural, one {# hour} other {# hours}} | {who} เปลี่ยนเวลาจองล่วงหน้าจาก {from} เป็น {to, plural, other {# ชั่วโมง}} |
| `Products.history.action.lead_time_set` | {who} set lead time to {to, plural, one {# hour} other {# hours}} | {who} ตั้งเวลาจองล่วงหน้าเป็น {to, plural, other {# ชั่วโมง}} |
| `Products.history.action.lead_time_clear` | {who} removed the lead time (it was {from, plural, one {# hour} other {# hours}}) | {who} ยกเลิกเวลาจองล่วงหน้า (เดิม {from, plural, other {# ชั่วโมง}}) |
| `Products.history.field.lead_time_hours` | Lead time (hours) | เวลาจองล่วงหน้า (ชั่วโมง) |
| `Fleet.motoMangos.walkinsHelp` (changed) | Bookings that are ready for immediate pickup today (overrides the lead time) | การจองที่พร้อมรับรถได้ทันทีในวันนี้ (ไม่ใช้เวลาจองล่วงหน้า) |

**Unchanged, now on the Moto Mangos tab** (listed so the whole tab can be read in one place; the review of these may already be done under stage A or B)

| Key | English | Thai |
| --- | --- | --- |
| `Fleet.motoMangos.title` | Moto Mangos | Moto Mangos |
| `Fleet.motoMangos.intro` | An online marketplace where you can list your rental bikes to be seen by renters in your area. | ตลาดออนไลน์ที่ร้านลงประกาศรถเช่าให้ผู้เช่าในพื้นที่ของคุณเห็นได้ |
| `Fleet.motoMangos.ready` | On the Moto Mangos list as {name}. | อยู่ในรายการของ Moto Mangos ในชื่อ {name} |
| `Fleet.motoMangos.list` | List this product on Moto Mangos | ลงประกาศสินค้านี้บน Moto Mangos |
| `Fleet.motoMangos.later` | Listing takes effect when Moto Mangos starts reading from this system. | การลงประกาศจะมีผลเมื่อ Moto Mangos เริ่มอ่านข้อมูลจากระบบนี้ |
| `Fleet.motoMangos.waiting` | Sent to Moto Mangos. It is waiting for review and goes live once approved; you can keep using the model meanwhile. | ส่งให้ Moto Mangos แล้ว กำลังรอตรวจ และจะขึ้นแสดงเมื่ออนุมัติ ระหว่างนี้ใช้งานรุ่นนี้ต่อได้ |
| `Fleet.motoMangos.submitTitle` | List it on Moto Mangos | ลงประกาศบน Moto Mangos |
| `Fleet.motoMangos.submit` | Send for review | ส่งให้ตรวจ |
| `Fleet.motoMangos.note` | Note for the reviewer | ข้อความถึงผู้ตรวจ |
| `Fleet.motoMangos.rejectedLinked` | Moto Mangos didn't add this model, so it can't be listed. It is still tied to that request because you have another model of your own with the same make and model, and a shop can't have two. | Moto Mangos ไม่ได้เพิ่มรุ่นนี้ จึงลงประกาศไม่ได้ รุ่นนี้ยังผูกกับคำขอนั้นอยู่ เพราะร้านมีอีกรุ่นของร้านเองที่ยี่ห้อและรุ่นเดียวกัน และร้านหนึ่งมีสองรุ่นซ้ำกันไม่ได้ |
| `Fleet.motoMangos.rejected` | Moto Mangos reviewed this model on {date} and didn't add it. | Moto Mangos ตรวจรุ่นนี้เมื่อ {date} และไม่ได้เพิ่มเข้ารายการ |
| `Fleet.motoMangos.rejectReason` | The reviewer's note: | หมายเหตุจากผู้ตรวจ: |
| `Fleet.motoMangos.rejectNoReason` | The reviewer left no note. You can change the details and send it again. | ผู้ตรวจไม่ได้เขียนหมายเหตุไว้ คุณแก้รายละเอียดแล้วส่งใหม่ได้ |
| `Fleet.motoMangos.approved` | Moto Mangos added this model to its list on {date}. | Moto Mangos เพิ่มรุ่นนี้เข้ารายการเมื่อ {date} |
| `Fleet.motoMangos.categoryFirst` | Choose a category for this product on the Details tab, save, and then you can send it to Moto Mangos. | เลือกหมวดหมู่ของสินค้านี้ที่แท็บรายละเอียด บันทึก แล้วจึงส่งให้ Moto Mangos ได้ |
| `Fleet.motoMangos.submitAgain` | Send for review again | ส่งให้ตรวจอีกครั้ง |
| `Fleet.motoMangos.nextTitle` | What to do next | ต้องทำอะไรต่อ |
| `Fleet.motoMangos.nextHelp` | Fix the details and send it for review again, or switch to a model that is already on the list. | แก้ไขรายละเอียดแล้วส่งให้ตรวจอีกครั้ง หรือเปลี่ยนไปใช้รุ่นที่อยู่ในรายการอยู่แล้ว |
| `Fleet.motoMangos.editAgain` | Edit and send again | แก้ไขแล้วส่งอีกครั้ง |
| `Fleet.motoMangos.chooseInstead` | Choose a model from the list instead | เลือกรุ่นจากรายการแทน |
| `Fleet.motoMangos.submitHelp` | Give its make, model, engine size, transmission and year: all five are needed. We review it first because it is new to our list. | ระบุยี่ห้อ รุ่น ขนาดเครื่องยนต์ ระบบเกียร์ และปี ต้องมีครบทั้งห้าอย่าง เราจะตรวจก่อนเพราะยังไม่อยู่ในรายการของเรา |
| `Fleet.motoMangos.selectFromList` | Select your make and model from the list | เลือกยี่ห้อและรุ่นของคุณจากรายการ |
| `Fleet.motoMangos.notInList` | Don’t see your bike above? Send us the details and we’ll get it added | ไม่เห็นรถของคุณด้านบน? ส่งรายละเอียดมาให้เรา แล้วเราจะเพิ่มให้ |
| `Fleet.motoMangos.bikeYear` | Year of your bike | ปีของรถคุณ |
| `Fleet.motoMangos.bikeYearHelp` | One year, like 2023. | ปีเดียว เช่น 2023 |
| `Fleet.motoMangos.listingTitle` | Listing | การลงประกาศ |
| `Fleet.motoMangos.listingLocked` | You can switch this on once a model is selected from the list above, or your request is approved. | เปิดใช้ได้เมื่อเลือกรุ่นจากรายการด้านบนแล้ว หรือเมื่อคำขอของคุณได้รับอนุมัติ |
| `Fleet.motoMangos.quantitiesTitle` | Set bike quantities per booking type | กำหนดจำนวนรถตามประเภทการจอง |
| `Fleet.motoMangos.instantHelp` | Future bookings that receive instant approval | การจองล่วงหน้าที่ได้รับการอนุมัติทันที |
| `Fleet.motoMangos.requestHelp` | Future bookings that require your approval | การจองล่วงหน้าที่ต้องรอร้านอนุมัติ |
| `Fleet.motoMangos.walkinsHelp` | Bookings that are ready for immediate pickup today (overrides the lead time) | การจองที่พร้อมรับรถได้ทันทีในวันนี้ (ไม่ใช้เวลาจองล่วงหน้า) |
| `Fleet.motoMangos.changeModel` | Change model | เปลี่ยนรุ่น |
| `Fleet.motoMangos.changeModelHelp` | Pick the make and model this product should be listed as. Your listing and its quantities stay as they are. | เลือกยี่ห้อและรุ่นที่ต้องการให้สินค้านี้ลงประกาศ การลงประกาศและจำนวนของคุณยังคงเดิม |
| `Fleet.motoMangos.changeModelLegend` | Select the new make and model | เลือกยี่ห้อและรุ่นใหม่ |
| `Fleet.motoMangos.disconnect` | Disconnect | ยกเลิกการเชื่อมต่อ |
| `Fleet.motoMangos.disconnectHelp` | Takes this product off Moto Mangos: the listing is switched off and its place on the list is cleared. | นำสินค้านี้ออกจาก Moto Mangos: ปิดการลงประกาศและล้างรายการที่เชื่อมไว้ |
| `Fleet.motoMangos.disconnectConfirm` | Disconnect this product from Moto Mangos? Its listing is switched off and its list entry is cleared. Bookings already made stay as they are. | ยกเลิกการเชื่อมต่อสินค้านี้กับ Moto Mangos หรือไม่? การลงประกาศจะถูกปิดและรายการที่เชื่อมไว้จะถูกล้าง การจองที่มีอยู่แล้วยังคงเดิม |
| `Fleet.motoMangos.upcomingBookings` | {count, plural, one {# upcoming booking on this product’s vehicles stays} other {# upcoming bookings on this product’s vehicles stay}} exactly as booked if you change the model or disconnect. | {count, plural, other {การจองที่กำลังจะมาถึง # รายการของรถในสินค้านี้}}จะยังคงเดิมทุกอย่าง แม้คุณเปลี่ยนรุ่นหรือยกเลิกการเชื่อมต่อ |
| `Fleet.model.instantUnits` | Instant units | จำนวนคันยืนยันทันที |
| `Fleet.model.requestUnits` | Request units | จำนวนคันขออนุมัติ |
| `Fleet.model.readyNow` | Walk-ins | ลูกค้าหน้าร้าน |

## Pricing, stage D5: the Pricing tab (15 Nov 2026)

Claude's translations, for Korn or BSR's admin (docs/products-redesign.md §9.12). The terms follow §9.12's provisional list: price ราคา, price list ตารางราคา, base price ราคาฐาน, multiplier ตัวคูณ, flat fee ราคาต่อช่วงเวลา, fixed price ราคาคงที่, free ฟรี, long-stay daily rate ราคาต่อวันสำหรับเช่าระยะยาว, deposit เงินมัดจำ, season ฤดูกาล, replacement value มูลค่าทดแทน.

- **Tax words are not ours to choose:** ภาษีมูลค่าเพิ่ม, รวมภาษีมูลค่าเพิ่ม and ไม่คิดภาษี are to be confirmed by Korn or the shop's accountant as the Revenue Department's wording.
- Thai has no plural: a count is one message with the number (`{count, plural, other {#}} วัน`).
- Amounts are never in a translation: `{amount}`, `{from}`, `{to}` are filled with the shop's currency in the viewer's number format.
- The six quick-entry boxes stack two to a row on a phone; the browser test checks the Thai labels fit at 375 px.

| Key | English | Thai |
| --- | --- | --- |
| `Fleet.motoMangos.noPrice` | No price by rental length yet: it won't be offered on Moto Mangos. Set one on the Pricing tab. | ยังไม่มีราคาตามระยะเวลาเช่า จึงจะไม่แสดงบน Moto Mangos ตั้งราคาได้ที่แท็บราคา |
| `Products.tabs.pricing` | Pricing | ราคา |
| `Products.history.pricing.box.daily` | daily | รายวัน |
| `Products.history.pricing.box.weekly` | weekly | รายสัปดาห์ |
| `Products.history.pricing.box.twoWeeks` | 2-week | 2 สัปดาห์ |
| `Products.history.pricing.box.threeWeeks` | 3-week | 3 สัปดาห์ |
| `Products.history.pricing.box.monthly` | monthly | รายเดือน |
| `Products.history.pricing.method.tiered` | By rental length | ตามระยะเวลาเช่า |
| `Products.history.pricing.method.per_period` | Flat fee per period | ราคาต่อช่วงเวลา |
| `Products.history.pricing.method.fixed` | Fixed price | ราคาคงที่ |
| `Products.history.pricing.method.free` | Free | ฟรี |
| `Products.history.pricing.method.none` | not priced | ยังไม่มีราคา |
| `Products.history.pricing.period.hour` | per hour | ต่อชั่วโมง |
| `Products.history.pricing.period.day` | per day | ต่อวัน |
| `Products.history.pricing.period.week` | per week | ต่อสัปดาห์ |
| `Products.history.pricing.period.month` | per month | ต่อเดือน |
| `Products.history.pricing.tax.default` | Shop default | ค่าเริ่มต้นของร้าน |
| `Products.history.pricing.tax.none` | Not taxable | ไม่คิดภาษี |
| `Products.history.pricing.tax.removed` | a removed tax profile | รายการภาษีที่ถูกลบแล้ว |
| `Products.history.pricing.line.methodSet` | {who} set how it is priced: {to} | {who} ตั้งวิธีคิดราคา: {to} |
| `Products.history.pricing.line.methodChanged` | {who} changed how it is priced from {from} to {to} | {who} เปลี่ยนวิธีคิดราคาจาก {from} เป็น {to} |
| `Products.history.pricing.line.firstPrice` | {who} set the price: daily {daily}, weekly {weekly}, 2 weeks {twoWeeks}, 3 weeks {threeWeeks}, monthly {monthly} | {who} ตั้งราคา: รายวัน {daily} รายสัปดาห์ {weekly} 2 สัปดาห์ {twoWeeks} 3 สัปดาห์ {threeWeeks} รายเดือน {monthly} |
| `Products.history.pricing.line.boxChanged` | {who} changed the {box} price from {from} to {to} | {who} เปลี่ยนราคา{box}จาก {from} เป็น {to} |
| `Products.history.pricing.line.dayChanged` | {who} changed the {days}-day price from {from} to {to} | {who} เปลี่ยนราคา {days} วันจาก {from} เป็น {to} |
| `Products.history.pricing.line.daysChanged` | {who} changed the prices of {count, plural, one {# day} other {# days}} | {who} เปลี่ยนราคา {count, plural, other {#}} วัน |
| `Products.history.pricing.line.otherDays` | {count, plural, one {# other day} other {# other days}} changed | วันอื่นเปลี่ยน {count, plural, other {#}} วัน |
| `Products.history.pricing.line.sharedListChanged` | Price list {list} changed (also used by {others, plural, one {# other product} other {# other products}}) | ตารางราคา {list} เปลี่ยน (ใช้กับสินค้าอื่นอีก {others, plural, other {#}} รายการ) |
| `Products.history.pricing.line.sharedDay` | {days, plural, one {# day} other {# days}}: {from} → {to} | {days, plural, other {#}} วัน: {from} → {to} |
| `Products.history.pricing.line.priceSet` | {who} set the price to {to} | {who} ตั้งราคาเป็น {to} |
| `Products.history.pricing.line.priceChanged` | {who} changed the price from {from} to {to} | {who} เปลี่ยนราคาจาก {from} เป็น {to} |
| `Products.history.pricing.line.priceRemoved` | {who} removed the price (it was {from}) | {who} ลบราคา (เดิม {from}) |
| `Products.history.pricing.line.pricePerSet` | {who} set the price to {to} {period} | {who} ตั้งราคาเป็น {to} {period} |
| `Products.history.pricing.line.pricePerChanged` | {who} changed the price from {from} to {to} {period} | {who} เปลี่ยนราคาจาก {from} เป็น {to} {period} |
| `Products.history.pricing.line.pricePerRemoved` | {who} removed the price (it was {from} {period}) | {who} ลบราคา (เดิม {from} {period}) |
| `Products.history.pricing.line.periodChanged` | {who} changed the period from {from} to {to} | {who} เปลี่ยนช่วงเวลาจาก {from} เป็น {to} |
| `Products.history.pricing.line.ownPrices` | {who} gave it its own prices | {who} กำหนดราคาของสินค้านี้เอง |
| `Products.history.pricing.line.ownPricesFrom` | {who} gave it its own prices (it was on {list}) | {who} กำหนดราคาของสินค้านี้เอง (เดิมใช้ {list}) |
| `Products.history.pricing.line.movedToList` | {who} moved it to the shared price list {list} | {who} ย้ายไปใช้ตารางราคา {list} |
| `Products.history.pricing.line.movedToListBase` | {who} moved it to the shared price list {list} with a base price of {base} | {who} ย้ายไปใช้ตารางราคา {list} ราคาฐาน {base} |
| `Products.history.pricing.line.baseSet` | {who} set the base price to {to} | {who} ตั้งราคาฐานเป็น {to} |
| `Products.history.pricing.line.baseChanged` | {who} changed the base price from {from} to {to} | {who} เปลี่ยนราคาฐานจาก {from} เป็น {to} |
| `Products.history.pricing.line.baseRemoved` | {who} removed the base price (it was {from}) | {who} ลบราคาฐาน (เดิม {from}) |
| `Products.history.pricing.line.longStaySet` | {who} set the long-stay daily rate to {to} | {who} ตั้งราคาต่อวันสำหรับเช่าระยะยาวเป็น {to} |
| `Products.history.pricing.line.longStayChanged` | {who} changed the long-stay daily rate from {from} to {to} | {who} เปลี่ยนราคาต่อวันสำหรับเช่าระยะยาวจาก {from} เป็น {to} |
| `Products.history.pricing.line.longStayRemoved` | {who} removed the long-stay daily rate (it was {from}) | {who} ลบราคาต่อวันสำหรับเช่าระยะยาว (เดิม {from}) |
| `Products.history.pricing.line.hourlySet` | {who} set the hourly price to {to} | {who} ตั้งราคารายชั่วโมงเป็น {to} |
| `Products.history.pricing.line.hourlyChanged` | {who} changed the hourly price from {from} to {to} | {who} เปลี่ยนราคารายชั่วโมงจาก {from} เป็น {to} |
| `Products.history.pricing.line.hourlyRemoved` | {who} removed the hourly price (it was {from}) | {who} ลบราคารายชั่วโมง (เดิม {from}) |
| `Products.history.pricing.line.depositSet` | {who} set the deposit to {to} | {who} ตั้งเงินมัดจำเป็น {to} |
| `Products.history.pricing.line.depositChanged` | {who} changed the deposit from {from} to {to} | {who} เปลี่ยนเงินมัดจำจาก {from} เป็น {to} |
| `Products.history.pricing.line.depositRemoved` | {who} removed the deposit (it was {from}) | {who} ลบเงินมัดจำ (เดิม {from}) |
| `Products.history.pricing.line.replacementSet` | {who} set the replacement value to {to} | {who} ตั้งมูลค่าทดแทนเป็น {to} |
| `Products.history.pricing.line.replacementChanged` | {who} changed the replacement value from {from} to {to} | {who} เปลี่ยนมูลค่าทดแทนจาก {from} เป็น {to} |
| `Products.history.pricing.line.replacementRemoved` | {who} removed the replacement value (it was {from}) | {who} ลบมูลค่าทดแทน (เดิม {from}) |
| `Products.history.pricing.line.taxChanged` | {who} changed tax from {from} to {to} | {who} เปลี่ยนภาษีจาก {from} เป็น {to} |
| `Products.priceLists` | Price lists | ตารางราคา |
| `Products.price.perDay` | {amount} / day | {amount} / วัน |
| `Products.price.per_hour` | {amount} / hour | {amount} / ชั่วโมง |
| `Products.price.per_day` | {amount} / day | {amount} / วัน |
| `Products.price.per_week` | {amount} / week | {amount} / สัปดาห์ |
| `Products.price.per_month` | {amount} / month | {amount} / เดือน |
| `Products.price.free` | Free | ฟรี |
| `Products.price.none` | No price yet | ยังไม่มีราคา |
| `Pricing.save` | Save prices | บันทึกราคา |
| `Pricing.readOnly` | You can see these prices but not change them. | คุณดูราคาเหล่านี้ได้ แต่แก้ไขไม่ได้ |
| `Pricing.method.title` | How it is priced | วิธีคิดราคา |
| `Pricing.method.tiered` | By rental length | ตามระยะเวลาเช่า |
| `Pricing.method.tieredHelp` | A total for each length from 1 to 30 days; longer rentals by the month. | ราคารวมสำหรับแต่ละระยะเวลา 1 ถึง 30 วัน เช่านานกว่านั้นคิดเป็นรายเดือน |
| `Pricing.method.per_period` | Flat fee per period | ราคาต่อช่วงเวลา |
| `Pricing.method.per_periodHelp` | One amount per hour, day, week or month. | ราคาเดียวต่อชั่วโมง วัน สัปดาห์ หรือเดือน |
| `Pricing.method.fixed` | Fixed price | ราคาคงที่ |
| `Pricing.method.fixedHelp` | One amount per order, however long. | ราคาเดียวต่อคำสั่งซื้อ ไม่ว่าจะเช่านานเท่าใด |
| `Pricing.method.free` | Free | ฟรี |
| `Pricing.method.freeHelp` | Shown as included; nothing is charged. | แสดงว่ารวมอยู่แล้ว ไม่คิดเงิน |
| `Pricing.period.hour` | Per hour | ต่อชั่วโมง |
| `Pricing.period.day` | Per day | ต่อวัน |
| `Pricing.period.week` | Per week | ต่อสัปดาห์ |
| `Pricing.period.month` | Per month | ต่อเดือน |
| `Pricing.flat.title` | Flat fee | ราคาต่อช่วงเวลา |
| `Pricing.flat.amount` | Amount ({currency}) | ราคา ({currency}) |
| `Pricing.flat.period` | Period | ช่วงเวลา |
| `Pricing.flat.help` | Every started period is charged. A week is 7 days; a month runs date to date from the pickup. | คิดทุกช่วงเวลาที่เริ่มแล้ว หนึ่งสัปดาห์คือ 7 วัน หนึ่งเดือนนับวันที่ถึงวันที่จากวันรับรถ |
| `Pricing.fixed.title` | Fixed price | ราคาคงที่ |
| `Pricing.fixed.amount` | Price ({currency}) | ราคา ({currency}) |
| `Pricing.fixed.help` | Charged once per order, whatever the length. | คิดครั้งเดียวต่อคำสั่งซื้อ ไม่ว่าจะเช่านานเท่าใด |
| `Pricing.free.title` | Free | ฟรี |
| `Pricing.free.help` | Shown as included on the order. Nothing is charged. | แสดงในคำสั่งซื้อว่ารวมอยู่แล้ว ไม่คิดเงิน |
| `Pricing.tiered.title` | By rental length | ตามระยะเวลาเช่า |
| `Pricing.tiered.own` | Set this product's own prices | กำหนดราคาของสินค้านี้เอง |
| `Pricing.tiered.ownHelp` | Type up to six prices; the days between fill in. | กรอกราคาได้สูงสุดหกช่อง วันที่อยู่ระหว่างกลางจะเติมให้เอง |
| `Pricing.tiered.shared` | Use a shared price list | ใช้ตารางราคาที่ใช้ร่วมกัน |
| `Pricing.tiered.sharedHelp` | One list for several products. Change it once, every product on it follows. | ตารางเดียวสำหรับหลายสินค้า แก้ครั้งเดียว ทุกสินค้าในตารางจะเปลี่ยนตาม |
| `Pricing.tiered.list` | Price list | ตารางราคา |
| `Pricing.tiered.pickList` | Choose a price list | เลือกตารางราคา |
| `Pricing.tiered.noLists` | There are no shared price lists yet. | ยังไม่มีตารางราคาที่ใช้ร่วมกัน |
| `Pricing.tiered.manageLists` | Manage price lists | จัดการตารางราคา |
| `Pricing.tiered.base` | Base price ({currency}) | ราคาฐาน ({currency}) |
| `Pricing.tiered.baseHelp` | This list holds multipliers. Each day's price is this base price × the day's multiplier. | ตารางนี้เก็บตัวคูณ ราคาแต่ละวันคือราคาฐานนี้ × ตัวคูณของวันนั้น |
| `Pricing.tiered.resulting` | Prices for this product | ราคาของสินค้านี้ |
| `Pricing.tiered.longStay` | Long-stay daily rate ({currency}) | ราคาต่อวันสำหรับเช่าระยะยาว ({currency}) |
| `Pricing.tiered.longStayHelp` | For each day after a whole month (rentals of 31 days or more). Blank: the monthly price ÷ 30. | สำหรับแต่ละวันหลังครบเดือน (เช่าตั้งแต่ 31 วันขึ้นไป) เว้นว่าง: ราคารายเดือน ÷ 30 |
| `Pricing.quick.title` | Quick price entry | กรอกราคาแบบด่วน |
| `Pricing.quick.help` | Daily and monthly are required. The days between fill in in equal steps; you can change any day below. | ต้องกรอกรายวันและรายเดือน วันระหว่างกลางจะเพิ่มขึ้นทีละเท่า ๆ กัน คุณแก้ไขวันใดก็ได้ด้านล่าง |
| `Pricing.quick.helpMultipliers` | Daily and monthly are required. Type multipliers, such as 3 or 1.1666. The days between fill in; you can change any day below. | ต้องกรอกรายวันและรายเดือน กรอกตัวคูณ เช่น 3 หรือ 1.1666 วันระหว่างกลางจะเติมให้เอง คุณแก้ไขวันใดก็ได้ด้านล่าง |
| `Pricing.quick.hourly` | Hourly | รายชั่วโมง |
| `Pricing.quick.daily` | Daily (1 day) | รายวัน (1 วัน) |
| `Pricing.quick.weekly` | Weekly (7 days) | รายสัปดาห์ (7 วัน) |
| `Pricing.quick.twoWeeks` | 2 weeks (14 days) | 2 สัปดาห์ (14 วัน) |
| `Pricing.quick.threeWeeks` | 3 weeks (21 days) | 3 สัปดาห์ (21 วัน) |
| `Pricing.quick.monthly` | Monthly (30 days) | รายเดือน (30 วัน) |
| `Pricing.quick.required` | Daily and monthly are both needed. | ต้องกรอกทั้งรายวันและรายเดือน |
| `Pricing.quick.requiredMark` | Required | จำเป็น |
| `Pricing.quick.invalid` | Enter an amount above 0, such as 300 or 300.50. | กรอกราคาที่มากกว่า 0 เช่น 300 หรือ 300.50 |
| `Pricing.quick.invalidMultiplier` | Enter a multiplier above 0, such as 3 or 1.1666. | กรอกตัวคูณที่มากกว่า 0 เช่น 3 หรือ 1.1666 |
| `Pricing.quick.sameEveryDay` | Same price every day | ราคาเท่ากันทุกวัน |
| `Pricing.grid.label` | Price for each length | ราคาสำหรับแต่ละระยะเวลา |
| `Pricing.grid.showAll` | Show all days | แสดงทุกวัน |
| `Pricing.grid.hide` | Hide the days | ซ่อนรายวัน |
| `Pricing.grid.day` | {days, plural, one {# day} other {# days}} | {days, plural, other {#}} วัน |
| `Pricing.grid.fromBox` | from quick entry | จากการกรอกด่วน |
| `Pricing.grid.byHand` | by hand | แก้เอง |
| `Pricing.grid.filled` | filled in | เติมให้อัตโนมัติ |
| `Pricing.grid.reset` | Reset | คืนค่า |
| `Pricing.grid.fallsTitle` | A longer rental can't cost less | เช่านานขึ้นต้องไม่ถูกลง |
| `Pricing.grid.falls` | {day} days cost less than {before} days. Raise it, or lower the days before it. Equal prices are fine. | {day} วันมีราคาต่ำกว่า {before} วัน ให้เพิ่มราคาวันนี้ หรือลดราคาวันก่อนหน้า ราคาเท่ากันได้ |
| `Pricing.grid.invalidDays` | A day typed by hand isn't a valid price. | มีวันที่แก้เองซึ่งไม่ใช่ราคาที่ถูกต้อง |
| `Pricing.deposit.title` | Deposit | เงินมัดจำ |
| `Pricing.deposit.amount` | Deposit ({currency}) | เงินมัดจำ ({currency}) |
| `Pricing.deposit.help` | Taken per vehicle on an order. Blank: the shop's amount; 0: no deposit. | เก็บต่อรถหนึ่งคันในคำสั่งซื้อ เว้นว่าง: ใช้จำนวนของร้าน 0: ไม่เก็บมัดจำ |
| `Pricing.deposit.shopAmount` | Blank uses the shop's amount: {amount}. 0: no deposit for this one. | เว้นว่างจะใช้จำนวนของร้าน: {amount} 0: ไม่เก็บมัดจำสำหรับคันนี้ |
| `Pricing.deposit.firstHelp` | Taken per vehicle on an order. The shop's other deposit choices come with its pricing settings. | เก็บต่อรถหนึ่งคันในคำสั่งซื้อ ตัวเลือกเงินมัดจำอื่นของร้านจะมาพร้อมการตั้งค่าราคา |
| `Pricing.deposit.none` | The shop takes no deposit. | ร้านไม่เก็บเงินมัดจำ |
| `Pricing.deposit.percent` | The shop takes {percent} of each order as a deposit. | ร้านเก็บเงินมัดจำ {percent} ของแต่ละคำสั่งซื้อ |
| `Pricing.deposit.fixed` | The shop takes {amount} per order as a deposit. | ร้านเก็บเงินมัดจำ {amount} ต่อคำสั่งซื้อ |
| `Pricing.tax.title` | Tax | ภาษี |
| `Pricing.tax.label` | Tax on this product | ภาษีของสินค้านี้ |
| `Pricing.tax.default` | Shop default ({name}) | ค่าเริ่มต้นของร้าน ({name}) |
| `Pricing.tax.defaultNone` | Shop default (no tax) | ค่าเริ่มต้นของร้าน (ไม่มีภาษี) |
| `Pricing.tax.none` | Not taxable | ไม่คิดภาษี |
| `Pricing.replacement.title` | Replacement value | มูลค่าทดแทน |
| `Pricing.replacement.amount` | Replacement value ({currency}) | มูลค่าทดแทน ({currency}) |
| `Pricing.replacement.help` | What a lost or broken item costs the customer. | จำนวนเงินที่ลูกค้าต้องจ่ายหากของหายหรือเสียหาย |
| `Pricing.seasons.title` | Seasons | ฤดูกาล |
| `Pricing.seasons.off` | {percent} off | ลด {percent} |
| `Pricing.seasons.more` | {percent} more | เพิ่ม {percent} |
| `Pricing.seasons.yearly` | {from} to {to}, every year | {from} ถึง {to} ทุกปี |
| `Pricing.seasons.once` | {from} to {to} | {from} ถึง {to} |
| `Pricing.seasons.help` | Seasons are set for the whole shop. They change the price for the part of a rental inside them. | ฤดูกาลตั้งไว้สำหรับทั้งร้าน และเปลี่ยนราคาเฉพาะส่วนของการเช่าที่อยู่ในช่วงนั้น |
| `Pricing.check.title` | Check a price | ตรวจสอบราคา |
| `Pricing.check.intro` | Prices a sample rental with these prices. | คิดราคาการเช่าตัวอย่างด้วยราคาเหล่านี้ |
| `Pricing.check.introUnsaved` | Prices a sample rental with the prices on screen, saved or not. | คิดราคาการเช่าตัวอย่างด้วยราคาบนหน้าจอ ไม่ว่าจะบันทึกแล้วหรือยัง |
| `Pricing.check.by` | Sample rental by | การเช่าตัวอย่างตาม |
| `Pricing.check.by_days` | Number of days | จำนวนวัน |
| `Pricing.check.by_dates` | Dates | วันที่ |
| `Pricing.check.pickup` | Pickup | รับรถ |
| `Pricing.check.return` | Return | คืนรถ |
| `Pricing.check.days` | Days | จำนวนวัน |
| `Pricing.check.quantity` | How many | จำนวน |
| `Pricing.check.notPriced` | Fill in the prices to check one. | กรอกราคาก่อนจึงจะตรวจสอบได้ |
| `Pricing.check.cantPrice` | This rental can't be priced. Check the dates and the quantity. | คิดราคาการเช่านี้ไม่ได้ โปรดตรวจสอบวันที่และจำนวน |
| `Pricing.check.listPrice` | List price | ราคาตามตาราง |
| `Pricing.check.season` | Season: {name} | ฤดูกาล: {name} |
| `Pricing.check.seasonDays` | {count, plural, one {# day} other {# days}} inside | {count, plural, other {#}} วันอยู่ในช่วง |
| `Pricing.check.vatIncluded` | Includes VAT {rate} | รวมภาษีมูลค่าเพิ่ม {rate} |
| `Pricing.check.vatAdded` | VAT {rate} | ภาษีมูลค่าเพิ่ม {rate} |
| `Pricing.check.total` | Total | รวม |
| `Pricing.check.deposit` | Deposit | เงินมัดจำ |
| `Pricing.check.depositHelp` | Taken beside the total; never taxed. | เก็บแยกจากยอดรวม ไม่คิดภาษี |
| `Pricing.basis.hours` | {hours, plural, one {# hour} other {# hours}} at {hourly} | {hours, plural, other {#}} ชั่วโมง ชั่วโมงละ {hourly} |
| `Pricing.basis.hoursCapped` | {hours, plural, one {# hour} other {# hours}}, held to the 1-day price | {hours, plural, other {#}} ชั่วโมง ไม่เกินราคา 1 วัน |
| `Pricing.basis.list` | {days, plural, one {# day} other {# days}} from the price list | {days, plural, other {#}} วัน ตามตารางราคา |
| `Pricing.basis.months` | {months, plural, one {# month} other {# months}} and {days, plural, one {# day} other {# days}} at {rate} a day | {months, plural, other {#}} เดือน และ {days, plural, other {#}} วัน วันละ {rate} |
| `Pricing.basis.underOneMonth` | 31 days started: the monthly price | เริ่มวันที่ 31 แล้ว: คิดราคารายเดือน |
| `Pricing.basis.periods_hour` | {count, plural, one {# hour} other {# hours}} | {count, plural, other {#}} ชั่วโมง |
| `Pricing.basis.periods_day` | {count, plural, one {# day} other {# days}} | {count, plural, other {#}} วัน |
| `Pricing.basis.periods_week` | {count, plural, one {# week} other {# weeks}} | {count, plural, other {#}} สัปดาห์ |
| `Pricing.basis.periods_month` | {count, plural, one {# month} other {# months}} | {count, plural, other {#}} เดือน |
| `Pricing.basis.fixed` | Fixed price | ราคาคงที่ |
| `Pricing.basis.free` | Free | ฟรี |
| `Pricing.lists.title` | Price lists | ตารางราคา |
| `Pricing.lists.intro` | Shared price lists. Each product on a list follows it. | ตารางราคาที่ใช้ร่วมกัน ทุกสินค้าในตารางจะใช้ราคาตามตาราง |
| `Pricing.lists.new` | New price list | ตารางราคาใหม่ |
| `Pricing.lists.none` | No shared price lists yet. | ยังไม่มีตารางราคาที่ใช้ร่วมกัน |
| `Pricing.lists.deleted` | Price list deleted. | ลบตารางราคาแล้ว |
| `Pricing.lists.products` | {count, plural, =0 {No products} one {# product} other {# products}} | {count, plural, =0 {ไม่มีสินค้า} other {# สินค้า}} |
| `Pricing.lists.firstDay` | 1 day: {amount} | 1 วัน: {amount} |
| `Pricing.lists.newTitle` | New price list | ตารางราคาใหม่ |
| `Pricing.lists.newIntro` | Choose its kind, name it and enter its prices. | เลือกประเภท ตั้งชื่อ และกรอกราคา |
| `Pricing.lists.editTitle` | Price list | ตารางราคา |
| `Pricing.lists.editIntro` | A shared price list. | ตารางราคาที่ใช้ร่วมกัน |
| `Pricing.lists.added` | Price list saved. | บันทึกตารางราคาแล้ว |
| `Pricing.lists.name` | Name | ชื่อ |
| `Pricing.lists.nameHelp` | For example 300–3000. Names are unique in the shop. | เช่น 300–3000 ชื่อต้องไม่ซ้ำกันในร้าน |
| `Pricing.lists.kind` | What does it hold? | ตารางนี้เก็บอะไร |
| `Pricing.lists.kindAmounts` | Amounts | จำนวนเงิน |
| `Pricing.lists.kindAmountsHelp` | The price for each length, in money. | ราคาสำหรับแต่ละระยะเวลาเป็นจำนวนเงิน |
| `Pricing.lists.kindMultipliers` | Multipliers of a base price | ตัวคูณของราคาฐาน |
| `Pricing.lists.kindMultipliersHelp` | Each product on it sets its own base price, which the list multiplies. | แต่ละสินค้าในตารางกำหนดราคาฐานของตัวเอง แล้วตารางจะคูณให้ |
| `Pricing.lists.kindFixed` | A list's kind can't be changed. | เปลี่ยนประเภทของตารางไม่ได้ |
| `Pricing.lists.sampleBase` | Sample base price ({currency}) | ราคาฐานตัวอย่าง ({currency}) |
| `Pricing.lists.sampleBaseHelp` | Shows what these multipliers come to at this base price. | แสดงราคาที่ได้จากตัวคูณเหล่านี้ที่ราคาฐานนี้ |
| `Pricing.lists.usedBy` | Products on this list | สินค้าในตารางนี้ |
| `Pricing.lists.unused` | No product uses this list yet. | ยังไม่มีสินค้าใช้ตารางนี้ |
| `Pricing.lists.repriceNote` | Saving changes the prices of {count, plural, one {this product} other {these # products}}: | การบันทึกจะเปลี่ยนราคาของสินค้า {count, plural, other {#}} รายการนี้: |
| `Pricing.lists.repriceConfirm` | Saving changes the prices of {count, plural, one {# product} other {# products}}. Save? | การบันทึกจะเปลี่ยนราคาของสินค้า {count, plural, other {#}} รายการ บันทึกหรือไม่ |
| `Pricing.lists.save` | Save price list | บันทึกตารางราคา |
| `Pricing.lists.create` | Create price list | สร้างตารางราคา |
| `Pricing.lists.delete` | Delete price list | ลบตารางราคา |
| `Pricing.lists.deleteConfirm` | Delete this price list? This can't be undone. | ลบตารางราคานี้หรือไม่ ยกเลิกไม่ได้ |
| `Pricing.lists.deleteBlocked` | A list can't be deleted while a product uses it. Move those products to other prices first. | ลบตารางไม่ได้ขณะที่มีสินค้าใช้อยู่ ให้ย้ายสินค้าเหล่านั้นไปใช้ราคาอื่นก่อน |
| `FormErrors.priceListFalls` | A longer rental can't cost less than a shorter one. Equal prices are fine. | เช่านานขึ้นต้องไม่ถูกกว่าเช่าสั้นกว่า ราคาเท่ากันได้ |
| `FormErrors.priceListIncomplete` | A price list needs all 30 days. | ตารางราคาต้องมีครบ 30 วัน |
| `FormErrors.priceListInUse` | This price list is used by a product, so it can't be deleted. Move those products to other prices first. | มีสินค้าใช้ตารางราคานี้อยู่ จึงลบไม่ได้ ให้ย้ายสินค้าเหล่านั้นไปใช้ราคาอื่นก่อน |
| `FormErrors.priceListKindFixed` | A price list's kind can't be changed. | เปลี่ยนประเภทของตารางราคาไม่ได้ |
| `FormErrors.priceListRequired` | Choose a price list, or set this product's own prices. | เลือกตารางราคา หรือกำหนดราคาของสินค้านี้เอง |
| `FormErrors.basePriceRequired` | This list holds multipliers: enter a base price. | ตารางนี้เก็บตัวคูณ: กรอกราคาฐาน |
| `FormErrors.priceRequired` | Enter a price. | กรอกราคา |
| `FormErrors.priceZero` | A price can't be 0. To charge nothing, choose Free. | ราคาเป็น 0 ไม่ได้ ถ้าไม่คิดเงิน ให้เลือกฟรี |
| `FormErrors.methodNotAllowed` | This kind of product can't be priced that way. | สินค้าประเภทนี้คิดราคาแบบนี้ไม่ได้ |
| `FormErrors.depositVehiclesOnly` | Only vehicles have a deposit. | มีเงินมัดจำได้เฉพาะรถเท่านั้น |
| `FormErrors.invalidTaxProfile` | That tax profile is no longer in use. | รายการภาษีนั้นไม่ได้ใช้งานแล้ว |
| `FormErrors.listNameExists` | The shop already has a price list with this name. | ร้านมีตารางราคาชื่อนี้อยู่แล้ว |
| `FormErrors.listNotReady` | Fill in daily and monthly, and fix the days marked in red, before saving. | กรอกรายวันและรายเดือน และแก้วันที่เป็นสีแดงก่อนบันทึก |

## Pricing, stage D6: Settings (15 Nov 2026)

Claude's translations, for Korn or BSR's admin (docs/products-redesign.md §9.12): the Settings sections, Pricing and tax, tax profiles, Seasons, and season lines in a product's History. 130 lines. The terms follow §9.12 and stage D5's list above.

- **A term to settle:** "tax profile" is ประเภทภาษี here; two D5 lines say รายการภาษี (`FormErrors.invalidTaxProfile`, `Products.history.pricing.tax.removed`). One word should be chosen for both.
- **Tax words are not ours to choose:** ราคาของเรารวมภาษีแล้ว ("Our prices include tax"), บวกภาษีเพิ่ม ("Tax is added on top") and ไม่คิดภาษี ("No tax") are to be confirmed by Korn or the shop's accountant as the Revenue Department's wording. The one-tap profile for Thailand is stored with the name "VAT 7%" in every language: it is the shop's data, which the owner can rename.
- **Seasons:** โลว์ซีซั่น is used as the example name, as shops say it. "20% off" and "20% more" are whole messages (ลด {percent}, เพิ่ม {percent}), never a sign joined to a number.
- Thai has no plural: a count is one message with the number (`{count, plural, other {สินค้า # รายการ}}`).
- Names, amounts and dates are never in a translation: `{names}`, `{amount}`, `{from}`, `{to}` are filled in the viewer's format. The browser test checks Pricing and tax and New season in Thai at 375 px.

| Key | English | Thai |
| --- | --- | --- |
| `Settings.nav.label` | Settings sections | หมวดการตั้งค่า |
| `Settings.nav.shop` | Shop | ร้าน |
| `Settings.nav.pricing` | Pricing and tax | ราคาและภาษี |
| `Settings.nav.seasons` | Seasons | ฤดูกาล |
| `Settings.nav.priceLists` | Price lists | ตารางราคา |
| `Settings.pricing.title` | Pricing and tax | ราคาและภาษี |
| `Settings.pricing.intro` | How the shop's prices are filled in, taxed and secured. Each product's own prices are on its Pricing tab. | วิธีกรอกราคา คิดภาษี และเก็บเงินมัดจำของร้าน ราคาของสินค้าแต่ละรายการอยู่ในแท็บราคาของสินค้านั้น |
| `Settings.pricing.save` | Save pricing settings | บันทึกการตั้งค่าราคา |
| `Settings.pricing.firstSaveNote` | Saving here for the first time fixes the shop's currency as {currency}. It can't be changed after that. | การบันทึกครั้งแรกที่นี่จะกำหนดสกุลเงินของร้านเป็น {currency} และเปลี่ยนภายหลังไม่ได้ |
| `Settings.pricing.firstSaveConfirm` | Saving fixes the shop's currency as {currency}, and it can't be changed after that. Save? | การบันทึกจะกำหนดสกุลเงินของร้านเป็น {currency} และเปลี่ยนภายหลังไม่ได้ บันทึกหรือไม่ |
| `Settings.pricing.rounding.title` | Rounding | การปัดเศษ |
| `Settings.pricing.rounding.intro` | Quick entry rounds the days it fills in to this step. Prices already saved never change. | การกรอกราคาด่วนจะปัดวันที่เติมให้อัตโนมัติตามขั้นนี้ ราคาที่บันทึกไว้แล้วจะไม่เปลี่ยน |
| `Settings.pricing.rounding.label` | Rounding step ({currency}) | ขั้นการปัดเศษ ({currency}) |
| `Settings.pricing.rounding.help` | Blank uses {step}. Changing it only affects days filled in from now on. | เว้นว่างจะใช้ {step} การเปลี่ยนมีผลเฉพาะวันที่เติมให้ตั้งแต่นี้ไป |
| `Settings.pricing.tax.title` | Tax | ภาษี |
| `Settings.pricing.tax.intro` | Whether the prices you type include tax, and the tax most products charge. | ราคาที่คุณกรอกรวมภาษีหรือไม่ และภาษีที่สินค้าส่วนใหญ่ใช้ |
| `Settings.pricing.tax.style` | Prices and tax | ราคาและภาษี |
| `Settings.pricing.tax.inclusive` | Our prices include tax | ราคาของเรารวมภาษีแล้ว |
| `Settings.pricing.tax.inclusiveHelp` | The price a customer sees is what they pay; the tax is worked out inside it. | ราคาที่ลูกค้าเห็นคือราคาที่จ่าย ภาษีคิดอยู่ในราคานั้น |
| `Settings.pricing.tax.exclusive` | Tax is added on top | บวกภาษีเพิ่ม |
| `Settings.pricing.tax.exclusiveHelp` | The prices you type are before tax; the tax is added to the total. | ราคาที่คุณกรอกเป็นราคาก่อนภาษี ภาษีจะบวกเข้าในยอดรวม |
| `Settings.pricing.tax.noProfiles` | Add a tax profile below to charge tax. Until then the shop charges no tax. | เพิ่มประเภทภาษีด้านล่างเพื่อคิดภาษี จนกว่าจะเพิ่ม ร้านจะไม่คิดภาษี |
| `Settings.pricing.tax.default` | Default tax profile | ประเภทภาษีเริ่มต้น |
| `Settings.pricing.tax.defaultHelp` | Used by every product set to "Shop default". | ใช้กับทุกสินค้าที่ตั้งเป็น "ค่าเริ่มต้นของร้าน" |
| `Settings.pricing.tax.defaultNone` | No tax | ไม่คิดภาษี |
| `Settings.pricing.deposit.title` | Deposit | เงินมัดจำ |
| `Settings.pricing.deposit.intro` | What an order asks as a deposit. Never taxed or discounted. | เงินมัดจำที่เก็บต่อคำสั่งซื้อ ไม่คิดภาษีและไม่มีส่วนลด |
| `Settings.pricing.deposit.none` | No deposit | ไม่เก็บเงินมัดจำ |
| `Settings.pricing.deposit.noneHelp` | Orders take no deposit. Deposits saved on vehicles are kept for later. | คำสั่งซื้อไม่เก็บเงินมัดจำ เงินมัดจำที่บันทึกไว้ในรถแต่ละคันจะเก็บไว้ใช้ภายหลัง |
| `Settings.pricing.deposit.percent_of_order` | A percentage of the order | เป็นเปอร์เซ็นต์ของคำสั่งซื้อ |
| `Settings.pricing.deposit.percent_of_orderHelp` | Of the order's total after discounts, tax included. | ของยอดรวมหลังหักส่วนลด รวมภาษีแล้ว |
| `Settings.pricing.deposit.fixed_per_order` | A fixed amount per order | จำนวนคงที่ต่อคำสั่งซื้อ |
| `Settings.pricing.deposit.fixed_per_orderHelp` | The same amount however many vehicles. | จำนวนเท่ากันไม่ว่าจะเช่ากี่คัน |
| `Settings.pricing.deposit.per_product` | Per vehicle | ต่อคัน |
| `Settings.pricing.deposit.per_productHelp` | Each vehicle's own deposit, set on its Pricing tab, times how many. | เงินมัดจำของรถแต่ละคันที่ตั้งในแท็บราคา คูณจำนวนคัน |
| `Settings.pricing.deposit.percent` | Percentage of the order | เปอร์เซ็นต์ของคำสั่งซื้อ |
| `Settings.pricing.deposit.percentHelp` | For example 20 or 12.5. | เช่น 20 หรือ 12.5 |
| `Settings.pricing.deposit.fixedAmount` | Amount per order ({currency}) | จำนวนต่อคำสั่งซื้อ ({currency}) |
| `Settings.pricing.deposit.fixedAmountHelp` | Taken once per order. | เก็บครั้งเดียวต่อคำสั่งซื้อ |
| `Settings.pricing.deposit.shopAmount` | Shop amount per vehicle ({currency}) | จำนวนของร้านต่อคัน ({currency}) |
| `Settings.pricing.deposit.shopAmountHelp` | For a vehicle with no deposit of its own. Blank: none. | สำหรับรถที่ไม่มีเงินมัดจำของตัวเอง เว้นว่าง: ไม่เก็บ |
| `Settings.pricing.coupons.title` | Coupons | คูปอง |
| `Settings.pricing.coupons.label` | Accept coupons | รับคูปอง |
| `Settings.pricing.coupons.later` | You will be able to create coupons in a later update. | คุณจะสร้างคูปองได้ในการอัปเดตครั้งต่อไป |
| `Settings.pricing.profiles.title` | Tax profiles | ประเภทภาษี |
| `Settings.pricing.profiles.intro` | A name and a rate for each tax the shop charges. Choose the default above. | ชื่อและอัตราของภาษีแต่ละประเภทที่ร้านเก็บ เลือกค่าเริ่มต้นด้านบน |
| `Settings.pricing.profiles.none` | No tax profiles yet. | ยังไม่มีประเภทภาษี |
| `Settings.pricing.profiles.isDefault` | Default | ค่าเริ่มต้น |
| `Settings.pricing.profiles.unused` | No product names this profile. | ไม่มีสินค้าที่ใช้ประเภทภาษีนี้ |
| `Settings.pricing.profiles.usedBy` | Named by {count, plural, one {# product} other {# products}}: {names} | ใช้กับ{count, plural, other {สินค้า # รายการ}}: {names} |
| `Settings.pricing.profiles.edit` | Change name or rate | เปลี่ยนชื่อหรืออัตรา |
| `Settings.pricing.profiles.save` | Save profile | บันทึกประเภทภาษี |
| `Settings.pricing.profiles.rateConfirm` | This changes the tax on {count, plural, one {# product} other {# products}}: {names}. Save? | การนี้จะเปลี่ยนภาษีของ{count, plural, other {สินค้า # รายการ}}: {names} บันทึกหรือไม่ |
| `Settings.pricing.profiles.remove` | Remove | นำออก |
| `Settings.pricing.profiles.removeConfirm` | Remove {name}? Products can't choose it any more. Old orders keep it. | นำ {name} ออกหรือไม่ สินค้าจะเลือกประเภทนี้ไม่ได้อีก คำสั่งซื้อเดิมยังคงใช้อยู่ |
| `Settings.pricing.profiles.addUsual` | Add {name} as the default | เพิ่ม {name} เป็นค่าเริ่มต้น |
| `Settings.pricing.profiles.add` | Add a tax profile | เพิ่มประเภทภาษี |
| `Settings.pricing.profiles.addSave` | Add profile | เพิ่มประเภทภาษี |
| `Settings.pricing.profiles.archived` | Removed profiles | ประเภทภาษีที่นำออกแล้ว |
| `Settings.pricing.profiles.restore` | Bring back | นำกลับมาใช้ |
| `Settings.pricing.profiles.name` | Name | ชื่อ |
| `Settings.pricing.profiles.rate` | Rate (%) | อัตรา (%) |
| `Settings.pricing.profiles.rateHelp` | For example 7. From 0 to 100. | เช่น 7 ตั้งแต่ 0 ถึง 100 |
| `Settings.seasons.title` | Seasons | ฤดูกาล |
| `Settings.seasons.intro` | Prices up or down by a percentage over a range of dates, on the part of a rental inside it. | ปรับราคาขึ้นหรือลงเป็นเปอร์เซ็นต์ในช่วงวันที่กำหนด เฉพาะส่วนของการเช่าที่อยู่ในช่วงนั้น |
| `Settings.seasons.new` | New season | ฤดูกาลใหม่ |
| `Settings.seasons.deleted` | Season deleted. | ลบฤดูกาลแล้ว |
| `Settings.seasons.none` | No seasons yet. | ยังไม่มีฤดูกาล |
| `Settings.seasons.off` | Off | ปิด |
| `Settings.seasons.yearly` | {from} to {to}, every year | {from} ถึง {to} ทุกปี |
| `Settings.seasons.once` | {from} to {to} | {from} ถึง {to} |
| `Settings.seasons.allProducts` | All products | สินค้าทั้งหมด |
| `Settings.seasons.someProducts` | {count, plural, =0 {No products} one {# product} other {# products}} | {count, plural, =0 {ไม่มีสินค้า} other {สินค้า # รายการ}} |
| `Settings.seasons.decreaseBy` | {percent} off | ลด {percent} |
| `Settings.seasons.increaseBy` | {percent} more | เพิ่ม {percent} |
| `Settings.seasons.newTitle` | New season | ฤดูกาลใหม่ |
| `Settings.seasons.newIntro` | Name it, choose its dates and how much prices change. | ตั้งชื่อ เลือกวันที่ และกำหนดว่าราคาจะเปลี่ยนเท่าใด |
| `Settings.seasons.editTitle` | Season | ฤดูกาล |
| `Settings.seasons.editIntro` | A season changes prices by rental length and flat fees only: never a fixed price, a free item or a deposit. | ฤดูกาลเปลี่ยนเฉพาะราคาตามระยะเวลาเช่าและราคาต่อช่วงเวลา ไม่เปลี่ยนราคาคงที่ สินค้าฟรี หรือเงินมัดจำ |
| `Settings.seasons.added` | Season saved. | บันทึกฤดูกาลแล้ว |
| `Settings.seasons.save` | Save season | บันทึกฤดูกาล |
| `Settings.seasons.create` | Create season | สร้างฤดูกาล |
| `Settings.seasons.name` | Name | ชื่อ |
| `Settings.seasons.nameHelp` | For example Low season. | เช่น โลว์ซีซั่น |
| `Settings.seasons.startsOn` | First day | วันแรก |
| `Settings.seasons.endsOn` | Last day | วันสุดท้าย |
| `Settings.seasons.repeatsYearly` | Every year | ทุกปี |
| `Settings.seasons.repeatsYearlyHelp` | The same days each year; the year is ignored, and a season may run over the new year. | วันเดียวกันทุกปี ไม่นับปี และฤดูกาลข้ามปีใหม่ได้ |
| `Settings.seasons.change` | Price change | การเปลี่ยนราคา |
| `Settings.seasons.changeIntro` | Worked out on the list price for the days of a rental inside the season. | คิดจากราคาตามตาราง สำหรับวันของการเช่าที่อยู่ในฤดูกาล |
| `Settings.seasons.direction` | Direction | ทิศทาง |
| `Settings.seasons.decrease` | Decrease | ลด |
| `Settings.seasons.increase` | Increase | เพิ่ม |
| `Settings.seasons.percent` | Percentage | เปอร์เซ็นต์ |
| `Settings.seasons.percentHelp` | For example 20 or 12.5. A decrease is below 100%. | เช่น 20 หรือ 12.5 การลดต้องน้อยกว่า 100% |
| `Settings.seasons.products` | Products | สินค้า |
| `Settings.seasons.productsIntro` | Which products it changes. | สินค้าที่ฤดูกาลนี้เปลี่ยนราคา |
| `Settings.seasons.scopeAll` | All products | สินค้าทั้งหมด |
| `Settings.seasons.scopeChosen` | Chosen products | สินค้าที่เลือก |
| `Settings.seasons.search` | Search products | ค้นหาสินค้า |
| `Settings.seasons.retired` | (retired) | (เลิกใช้แล้ว) |
| `Settings.seasons.active` | Season on | เปิดฤดูกาล |
| `Settings.seasons.activeHelp` | Switched off, it stays saved and changes no price. | เมื่อปิด ฤดูกาลยังบันทึกไว้และไม่เปลี่ยนราคา |
| `Settings.seasons.delete` | Delete season | ลบฤดูกาล |
| `Settings.seasons.deleteConfirm` | Delete this season? This can't be undone. | ลบฤดูกาลนี้หรือไม่ ย้อนกลับไม่ได้ |
| `Products.history.pricing.line.seasonAdded` | {who} added the season {name}: {change}, {when} | {who} เพิ่มฤดูกาล {name}: {change} {when} |
| `Products.history.pricing.line.seasonRemoved` | {who} removed the season {name} | {who} นำฤดูกาล {name} ออก |
| `Products.history.pricing.line.seasonChanged` | {who} changed the season {name} from {from} to {to} | {who} เปลี่ยนฤดูกาล {name} จาก {from} เป็น {to} |
| `Products.history.pricing.line.seasonDatesChanged` | {who} changed the dates of the season {name} from {from} to {to} | {who} เปลี่ยนวันที่ของฤดูกาล {name} จาก {from} เป็น {to} |
| `Products.history.pricing.line.seasonRenamed` | {who} renamed the season {from} to {to} | {who} เปลี่ยนชื่อฤดูกาล {from} เป็น {to} |
| `Products.history.pricing.line.seasonOff` | {who} switched off the season {name} | {who} ปิดฤดูกาล {name} |
| `Products.history.pricing.line.seasonOn` | {who} switched on the season {name} | {who} เปิดฤดูกาล {name} |
| `Products.history.pricing.seasonOff` | {percent} off | ลด {percent} |
| `Products.history.pricing.seasonMore` | {percent} more | เพิ่ม {percent} |
| `Products.history.pricing.seasonYearly` | {from} to {to}, every year | {from} ถึง {to} ทุกปี |
| `Products.history.pricing.seasonOnce` | {from} to {to} | {from} ถึง {to} |
| `Pricing.deposit.change` | Change in Settings | เปลี่ยนในการตั้งค่า |
| `FormErrors.invalidPercent` | Enter a percentage such as 20 or 12.5. | กรอกเปอร์เซ็นต์ เช่น 20 หรือ 12.5 |
| `FormErrors.percentZero` | Enter a percentage above 0. | กรอกเปอร์เซ็นต์ที่มากกว่า 0 |
| `FormErrors.decreaseTooLarge` | A decrease must be below 100%. | การลดต้องน้อยกว่า 100% |
| `FormErrors.increaseTooLarge` | At most 1,000%. | สูงสุด 1,000% |
| `FormErrors.seasonEndsBeforeStart` | The last day is before the first. Tick "Every year" for a season over the new year. | วันสุดท้ายอยู่ก่อนวันแรก เลือก "ทุกปี" สำหรับฤดูกาลที่ข้ามปีใหม่ |
| `FormErrors.seasonNoProducts` | Choose at least one product, or All products. | เลือกสินค้าอย่างน้อยหนึ่งรายการ หรือสินค้าทั้งหมด |
| `FormErrors.invalidRate` | Enter a rate from 0 to 100. | กรอกอัตราตั้งแต่ 0 ถึง 100 |
| `FormErrors.taxProfileInUse` | Still named by {count, plural, one {# product} other {# products}}: {names}. Move them to another tax choice on their Pricing tab first. | ยังมี{count, plural, other {สินค้า # รายการ}}ที่ใช้อยู่: {names} ย้ายไปใช้ภาษีแบบอื่นในแท็บราคาของสินค้านั้นก่อน |
| `FormErrors.taxProfileIsDefault` | This is the shop's default tax profile. Choose another default first. | นี่คือประเภทภาษีเริ่มต้นของร้าน เลือกค่าเริ่มต้นอื่นก่อน |
| `FormErrors.profileNameExists` | A tax profile with this name already exists. | มีประเภทภาษีชื่อนี้แล้ว |
| `FormErrors.depositNumberRequired` | Enter the deposit's percentage or amount. | กรอกเปอร์เซ็นต์หรือจำนวนเงินมัดจำ |
| `FormErrors.invalidSeason` | Check the season's details and try again. | ตรวจสอบรายละเอียดของฤดูกาลแล้วลองอีกครั้ง |
| `FormErrors.profileAddedNotDefault` | The profile was added but couldn't be made the default. Choose it above and save. | เพิ่มประเภทภาษีแล้ว แต่ตั้งเป็นค่าเริ่มต้นไม่ได้ เลือกด้านบนแล้วบันทึก |
| `FormErrors.unit_busy` | Someone is saving a booking or a block on this one right now. Please try again. | มีคนกำลังบันทึกการจองหรือบล็อกของรายการนี้อยู่ โปรดลองอีกครั้ง |
| `Fleet.unit.moveBookingsConfirm` | This vehicle has an upcoming booking. It will move with it to {destination}. / This vehicle has # upcoming bookings. They will move with it to {destination}. | {count, plural, other {รถคันนี้มีการจองที่กำลังจะมาถึง # รายการ การจองจะย้ายตามรถไปที่ {destination}}} |
| `FormErrors.unit_has_bookings` | This vehicle has upcoming bookings. Change its product or location on its Details form, which moves the bookings with it. | รถคันนี้มีการจองที่กำลังจะมาถึง เปลี่ยนสินค้าหรือสาขาในฟอร์มรายละเอียดของรถ ซึ่งจะย้ายการจองตามไปด้วย |
| `FormErrors.bookingsChanged` | This vehicle's bookings changed while this form was open. Reload the page to see them, then make your change again. | การจองของรถคันนี้เปลี่ยนไปขณะที่ฟอร์มนี้เปิดอยู่ โหลดหน้านี้ใหม่เพื่อดูข้อมูลล่าสุด แล้วแก้ไขอีกครั้ง |

## Phase 2, stage 6: extras on screens (17 Nov 2026)

Claude’s translations, for Korn or BSR’s admin: the Extras tab of a vehicle, Settings › Extras, the History lines and the save messages. 63 lines.

- **Extras is ของเสริม** (the tab, the Settings section and the messages). The words already used for the products themselves stay: rental gear อุปกรณ์ให้เช่า, service บริการ.
- **“Most per vehicle” is สูงสุดต่อคัน** (the owner’s label, 17 Nov 2026: up to N with each vehicle, not per booking). “Included free” is รวมให้ฟรี.
- **“Not offered for this vehicle” is ไม่เสนอสำหรับรถรุ่นนี้**: รุ่น because the switch is on the vehicle product, which covers every bike of that model.
- Thai has no plural: `{count}` is a number in a sentence. Names and numbers are never in a translation.

| Key | English | Thai |
| --- | --- | --- |
| `Settings.nav.extras` | Extras | ของเสริม |
| `Settings.extras.title` | Extras | ของเสริม |
| `Settings.extras.intro` | The rental gear and services offered with every vehicle of the shop. | อุปกรณ์ให้เช่าและบริการที่ร้านเสนอพร้อมรถทุกคัน |
| `FormErrors.extrasTryAgain` | Someone is saving a booking for this vehicle right now, so nothing was saved. Please try again. | มีคนกำลังบันทึกการจองของรถรุ่นนี้อยู่ จึงยังไม่ได้บันทึก โปรดลองอีกครั้ง |
| `FormErrors.extrasOnlyOwnerOrManager` | Only an owner or a manager can change extras. | เฉพาะเจ้าของหรือผู้จัดการเท่านั้นที่เปลี่ยนของเสริมได้ |
| `FormErrors.extrasInvalid` | Check the extras and try again. | ตรวจสอบของเสริมแล้วลองอีกครั้ง |
| `FormErrors.extrasProductNotFound` | This vehicle no longer exists. Reload the page. | ไม่มีรถรุ่นนี้แล้ว โหลดหน้านี้ใหม่ |
| `FormErrors.extrasExtraNotFound` | One of these extras no longer exists, or isn't rental gear or a service. Reload the page. | ของเสริมบางรายการไม่มีอยู่แล้ว หรือไม่ใช่อุปกรณ์ให้เช่าหรือบริการ โหลดหน้านี้ใหม่ |
| `FormErrors.extrasMostBelowIncluded` | The most per vehicle can't be below the number included. | จำนวนสูงสุดต่อคันต้องไม่น้อยกว่าจำนวนที่รวมให้ |
| `FormErrors.extrasCheckLines` | Check the lines marked below. | ตรวจสอบรายการที่มีเครื่องหมายด้านล่าง |
| `Products.tabs.extras` | Extras | ของเสริม |
| `Products.history.extras.everyTitle` | History | ประวัติ |
| `Products.history.extras.one` | {who} {what} | {who} {what} |
| `Products.history.extras.oneEvery` | {who} {what} (every vehicle) | {who} {what} (รถทุกคัน) |
| `Products.history.extras.many` | {who} changed the extras | {who} เปลี่ยนของเสริม |
| `Products.history.extras.manyEvery` | {who} changed the extras offered with every vehicle | {who} เปลี่ยนของเสริมที่เสนอพร้อมรถทุกคัน |
| `Products.history.extras.added` | added {name}: {included} included, no limit per vehicle | เพิ่ม {name}: รวมให้ {included} ไม่จำกัดต่อคัน |
| `Products.history.extras.addedMost` | added {name}: {included} included, most {most} per vehicle | เพิ่ม {name}: รวมให้ {included} สูงสุด {most} ต่อคัน |
| `Products.history.extras.removed` | removed {name} | นำ {name} ออก |
| `Products.history.extras.notOffered` | set {name} to Not offered for this vehicle | ตั้ง {name} เป็นไม่เสนอสำหรับรถรุ่นนี้ |
| `Products.history.extras.offeredAgain` | offered {name} again, as the list for every vehicle says | เสนอ {name} อีกครั้งตามรายการสำหรับรถทุกคัน |
| `Products.history.extras.reordered` | changed the order of the extras | เปลี่ยนลำดับของเสริม |
| `Products.history.extras.includedChanged` | changed {name}'s included from {from} to {to} | เปลี่ยนจำนวนที่รวมให้ของ {name} จาก {from} เป็น {to} |
| `Products.history.extras.mostChanged` | changed {name}'s most per vehicle from {from} to {to} | เปลี่ยนจำนวนสูงสุดต่อคันของ {name} จาก {from} เป็น {to} |
| `Products.history.extras.noLimit` | no limit | ไม่จำกัด |
| `Products.history.extras.deletedName` | {name} (deleted) | {name} (ลบแล้ว) |
| `Products.history.extras.removedProduct` | a deleted product | สินค้าที่ถูกลบ |
| `Products.extras.intro` | The rental gear and services offered with this vehicle. Online bookings take up to the most per vehicle; staff can add more at the counter. | อุปกรณ์ให้เช่าและบริการที่เสนอพร้อมรถรุ่นนี้ การจองออนไลน์รับได้ไม่เกินจำนวนสูงสุดต่อคัน พนักงานที่หน้าร้านเพิ่มได้มากกว่านั้น |
| `Products.extras.introRead` | The rental gear and services offered with this vehicle. | อุปกรณ์ให้เช่าและบริการที่เสนอพร้อมรถรุ่นนี้ |
| `Products.extras.everyIntro` | Offered with every vehicle. A vehicle can set its own, or switch one off with "Not offered for this vehicle", on its Extras tab. | เสนอพร้อมรถทุกคัน รถแต่ละรุ่นตั้งค่าของตัวเองได้ หรือปิดรายการด้วย "ไม่เสนอสำหรับรถรุ่นนี้" ในแท็บของเสริมของรถรุ่นนั้น |
| `Products.extras.ownTitle` | Offered with this vehicle | เสนอพร้อมรถรุ่นนี้ |
| `Products.extras.everyTitle` | Offered with every vehicle | เสนอพร้อมรถทุกคัน |
| `Products.extras.ownNone` | Nothing of its own yet. | ยังไม่มีรายการของรถรุ่นนี้เอง |
| `Products.extras.everyNone` | Nothing is offered with every vehicle yet. | ยังไม่มีรายการที่เสนอพร้อมรถทุกคัน |
| `Products.extras.shopTitle` | From the list for every vehicle | จากรายการสำหรับรถทุกคัน |
| `Products.extras.shopIntro` | Offered with this vehicle too, unless you switch it off here. | เสนอพร้อมรถรุ่นนี้ด้วย เว้นแต่จะปิดไว้ที่นี่ |
| `Products.extras.shopNone` | The shop offers nothing with every vehicle. | ร้านยังไม่มีรายการที่เสนอพร้อมรถทุกคัน |
| `Products.extras.shopLink` | Settings › Extras: what every vehicle offers | การตั้งค่า › ของเสริม: รายการสำหรับรถทุกคัน |
| `Products.extras.setAbove` | Set for this vehicle above. | ตั้งค่าสำหรับรถรุ่นนี้ไว้ด้านบนแล้ว |
| `Products.extras.notOffered` | Not offered for this vehicle | ไม่เสนอสำหรับรถรุ่นนี้ |
| `Products.extras.notOfferedHere` | Not offered for this vehicle. | ไม่เสนอสำหรับรถรุ่นนี้ |
| `Products.extras.included` | Included free | รวมให้ฟรี |
| `Products.extras.includedHelp` | Free with each vehicle. | ฟรีกับรถแต่ละคัน |
| `Products.extras.most` | Most per vehicle | สูงสุดต่อคัน |
| `Products.extras.mostHelp` | Online bookings take up to this many with each vehicle. Empty: no limit. | การจองออนไลน์รับได้ไม่เกินจำนวนนี้ต่อรถหนึ่งคัน เว้นว่าง: ไม่จำกัด |
| `Products.extras.noLimit` | No limit | ไม่จำกัด |
| `Products.extras.includedCount` | {count} included | รวมให้ {count} |
| `Products.extras.mostCount` | Most per vehicle: {count} | สูงสุดต่อคัน: {count} |
| `Products.extras.mostNone` | Most per vehicle: no limit | สูงสุดต่อคัน: ไม่จำกัด |
| `Products.extras.addLabel` | Add rental gear or a service | เพิ่มอุปกรณ์ให้เช่าหรือบริการ |
| `Products.extras.choose` | Choose… | เลือก… |
| `Products.extras.add` | Add | เพิ่ม |
| `Products.extras.save` | Save extras | บันทึกของเสริม |
| `Products.extras.moveUp` | Move {name} up | เลื่อน {name} ขึ้น |
| `Products.extras.moveDown` | Move {name} down | เลื่อน {name} ลง |
| `Products.extras.remove` | Remove {name} | นำ {name} ออก |
| `Products.extras.unknown` | A product that no longer exists | สินค้าที่ไม่มีอยู่แล้ว |
| `Products.extras.retired` | Retired: not offered | ปลดระวาง: ไม่เสนอ |
| `Products.extras.noPrice` | No price yet: not offered | ยังไม่มีราคา: ไม่เสนอ |
| `Products.extras.noProducts` | The shop has no rental gear or services yet. Add them on the Products page. | ร้านยังไม่มีอุปกรณ์ให้เช่าหรือบริการ เพิ่มได้ที่หน้าสินค้า |
| `Products.extras.readOnly` | Only an owner or a manager can change extras. | เฉพาะเจ้าของหรือผู้จัดการเท่านั้นที่เปลี่ยนของเสริมได้ |
| `Products.extras.type.gear` | Rental gear | อุปกรณ์ให้เช่า |
| `Products.extras.type.service` | Service | บริการ |

## Phase 2, stage 9: coupon screens (18 Nov 2026)

New Thai lines on the branch `platform/phase-2-stage-9-coupon-screens`: Settings › Coupons (list, form, History), the returning-customer card on Settings › Pricing and tax, Check a price with extras, a coupon code and the "Returning customer" tick, and the words for every coupon refusal. Claude's translations; please check. Words chosen: คูปอง (coupon), ส่วนลดลูกค้าเก่า (returning-customer discount), เก็บถาวร (archive), นำกลับมา (bring back), ใช้ร่วมกับ (combined with). Gone: `Settings.pricing.coupons.later`.

| Key | English | Thai |
| --- | --- | --- |
| `Settings.nav.coupons` | Coupons | คูปอง |
| `Settings.coupons.title` | Coupons | คูปอง |
| `Settings.coupons.intro` | Codes a customer gives for a discount. Each one says how much it takes off, on what, and when. | รหัสที่ลูกค้าใช้รับส่วนลด แต่ละรหัสกำหนดว่าลดเท่าไร ใช้กับอะไร และใช้ได้เมื่อไร |
| `Settings.coupons.new` | New coupon | คูปองใหม่ |
| `Settings.coupons.none` | No coupons yet. Start with “New coupon”. | ยังไม่มีคูปอง เริ่มที่ “คูปองใหม่” |
| `Settings.coupons.listLabel` | Coupons | คูปอง |
| `Settings.coupons.notAccepting` | The shop doesn’t accept coupons right now, so no code takes anything off. You can still create and edit coupons. Switch on “Accept coupons” in <link>Settings › Pricing and tax</link>. | ขณะนี้ร้านไม่รับคูปอง จึงไม่มีรหัสใดลดราคาได้ แต่ยังสร้างและแก้ไขคูปองได้ เปิด “รับคูปอง” ได้ที่ <link>การตั้งค่า › ราคาและภาษี</link> |
| `Settings.coupons.status_on` | On | เปิด |
| `Settings.coupons.status_off` | Off | ปิด |
| `Settings.coupons.status_archived` | Archived | เก็บถาวร |
| `Settings.coupons.percentOff` | {percent} off | ลด {percent} |
| `Settings.coupons.amountOff` | {amount} off | ลด {amount} |
| `Settings.coupons.usesOf` | Used {used} of {limit} | ใช้แล้ว {used} จาก {limit} |
| `Settings.coupons.usesNoLimit` | Used {used} | ใช้แล้ว {used} |
| `Settings.coupons.usesUnknown` | Uses: not shown (its code is used by a newer coupon) | จำนวนที่ใช้: ไม่แสดง (คูปองใหม่ใช้รหัสนี้แล้ว) |
| `Settings.coupons.edit` | Edit | แก้ไข |
| `Settings.coupons.view` | View | ดู |
| `Settings.coupons.switchOn` | Switch on | เปิด |
| `Settings.coupons.switchOff` | Switch off | ปิด |
| `Settings.coupons.archive` | Archive | เก็บถาวร |
| `Settings.coupons.restore` | Bring back | นำกลับมา |
| `Settings.coupons.archiveConfirm` | Archive {code}? It can no longer be used, and its code becomes free for a new coupon. Bookings that used it keep their discount. | เก็บ {code} ถาวรหรือไม่ จะใช้คูปองนี้ไม่ได้อีก และรหัสนี้จะนำไปใช้กับคูปองใหม่ได้ การจองที่ใช้ไปแล้วยังได้ส่วนลดเหมือนเดิม |
| `Settings.coupons.newTitle` | New coupon | คูปองใหม่ |
| `Settings.coupons.newIntro` | Only the code and the discount are needed. Leave a box empty for no limit. | ต้องกรอกเพียงรหัสและส่วนลด เว้นช่องว่างไว้หากไม่จำกัด |
| `Settings.coupons.editTitle` | Coupon | คูปอง |
| `Settings.coupons.editIntro` | This coupon is on: customers can use its code. | คูปองนี้เปิดอยู่: ลูกค้าใช้รหัสนี้ได้ |
| `Settings.coupons.offIntro` | This coupon is off: its code takes nothing off until it is switched on. | คูปองนี้ปิดอยู่: รหัสนี้จะไม่ลดราคาจนกว่าจะเปิด |
| `Settings.coupons.archivedIntro` | This coupon is archived and can’t be changed. “Bring back” makes it usable again, unless another coupon has its code now. | คูปองนี้ถูกเก็บถาวรและแก้ไขไม่ได้ “นำกลับมา” จะทำให้ใช้ได้อีกครั้ง เว้นแต่มีคูปองอื่นใช้รหัสนี้อยู่ |
| `Settings.coupons.added` | Coupon created. | สร้างคูปองแล้ว |
| `Settings.coupons.save` | Save coupon | บันทึกคูปอง |
| `Settings.coupons.create` | Create coupon | สร้างคูปอง |
| `Settings.coupons.code` | Code | รหัส |
| `Settings.coupons.codeHelp` | What the customer types. Letters A to Z and numbers 0 to 9, up to 40. Spaces are taken out and small letters made capitals. | สิ่งที่ลูกค้าพิมพ์ ใช้ตัวอักษร A ถึง Z และตัวเลข 0 ถึง 9 ไม่เกิน 40 ตัว ระบบจะตัดช่องว่างออกและเปลี่ยนตัวพิมพ์เล็กเป็นตัวพิมพ์ใหญ่ |
| `Settings.coupons.codeStoredAs` | Saved as {code} | จะบันทึกเป็น {code} |
| `Settings.coupons.codeCantSave` | This code can’t be saved: use only the letters A to Z and the numbers 0 to 9. Thai letters and full-width characters (such as Ａ or ０) can’t be used. | บันทึกรหัสนี้ไม่ได้: ใช้ได้เฉพาะตัวอักษร A ถึง Z และตัวเลข 0 ถึง 9 ใช้อักษรไทยและอักขระแบบเต็มความกว้าง (เช่น Ａ หรือ ０) ไม่ได้ |
| `Settings.coupons.name` | Name (for the shop) | ชื่อ (สำหรับร้าน) |
| `Settings.coupons.nameHelp` | Your own note, such as “Songkran flyer”. Customers don’t see it. | บันทึกของร้านเอง เช่น “ใบปลิวสงกรานต์” ลูกค้าไม่เห็น |
| `Settings.coupons.value` | Discount | ส่วนลด |
| `Settings.coupons.kind` | Kind | ประเภท |
| `Settings.coupons.kindPercent` | Percentage | เปอร์เซ็นต์ |
| `Settings.coupons.kindFixed` | Fixed amount | จำนวนเงินคงที่ |
| `Settings.coupons.percent` | Percentage off | ลดกี่เปอร์เซ็นต์ |
| `Settings.coupons.percentHelp` | Such as 10 or 12.5. Taken off each of the coupon’s lines after seasonal prices. | เช่น 10 หรือ 12.5 หักจากแต่ละรายการของคูปองหลังคิดราคาตามฤดูกาล |
| `Settings.coupons.amount` | Amount off ({currency}) | จำนวนเงินที่ลด ({currency}) |
| `Settings.coupons.amountHelp` | Off the coupon’s lines together, never more than they come to. Never off a deposit. | หักจากรายการของคูปองรวมกัน ไม่เกินยอดของรายการเหล่านั้น และไม่หักจากเงินมัดจำ |
| `Settings.coupons.products` | Products | สินค้า |
| `Settings.coupons.productsIntro` | The lines it takes money off. A coupon for chosen scooters does not reduce the helmets beside them. | รายการที่คูปองนี้ลดราคา คูปองสำหรับสกู๊ตเตอร์ที่เลือกจะไม่ลดราคาหมวกกันน็อกที่เช่าพร้อมกัน |
| `Settings.coupons.scopeAll` | All products | สินค้าทั้งหมด |
| `Settings.coupons.scopeChosen` | Chosen products | สินค้าที่เลือก |
| `Settings.coupons.search` | Find a product | ค้นหาสินค้า |
| `Settings.coupons.retired` | (retired) | (เลิกใช้แล้ว) |
| `Settings.coupons.valid` | Valid dates | ช่วงวันที่ใช้ได้ |
| `Settings.coupons.validIntro` | The days a booking can be made with it, on the shop’s calendar. Leave empty for any day. | วันที่ทำการจองด้วยคูปองนี้ได้ ตามปฏิทินของร้าน เว้นว่างไว้หากใช้ได้ทุกวัน |
| `Settings.coupons.validFrom` | First day | วันแรก |
| `Settings.coupons.validTo` | Last day | วันสุดท้าย |
| `Settings.coupons.pickup` | Pickup dates | ช่วงวันรับรถ |
| `Settings.coupons.pickupIntro` | The rental must start between these days. Leave empty for any pickup. | การเช่าต้องเริ่มระหว่างวันเหล่านี้ เว้นว่างไว้หากรับรถวันใดก็ได้ |
| `Settings.coupons.pickupFrom` | Pickup from | รับรถตั้งแต่ |
| `Settings.coupons.pickupTo` | Pickup until | รับรถถึง |
| `Settings.coupons.limits` | Limits | เงื่อนไข |
| `Settings.coupons.minDays` | Minimum days | จำนวนวันขั้นต่ำ |
| `Settings.coupons.minDaysHelp` | The rental must be at least this many days. Empty: any length. | ต้องเช่าอย่างน้อยกี่วัน เว้นว่าง: กี่วันก็ได้ |
| `Settings.coupons.minSpend` | Minimum spend ({currency}) | ยอดขั้นต่ำ ({currency}) |
| `Settings.coupons.minSpendHelp` | Counts only this coupon’s own lines, after seasonal prices and before any discount. Empty: no minimum. | นับเฉพาะรายการของคูปองนี้ หลังคิดราคาตามฤดูกาลและก่อนหักส่วนลดใดๆ เว้นว่าง: ไม่มีขั้นต่ำ |
| `Settings.coupons.maxUses` | Total uses | จำนวนครั้งที่ใช้ได้ทั้งหมด |
| `Settings.coupons.maxUsesHelp` | How many bookings can use it, in all. A cancelled booking gives its use back. Empty: no limit. | ใช้ได้กี่การจองทั้งหมด การจองที่ยกเลิกจะคืนสิทธิ์ เว้นว่าง: ไม่จำกัด |
| `Settings.coupons.channels` | Where it can be used | ใช้ได้ที่ไหน |
| `Settings.coupons.channelsIntro` | Choose at least one. | เลือกอย่างน้อยหนึ่งช่องทาง |
| `Settings.coupons.channel_staff` | By staff, at the counter or on the phone | พนักงาน ที่หน้าร้านหรือทางโทรศัพท์ |
| `Settings.coupons.channel_booking_page` | On the shop’s booking page | บนหน้าจองของร้าน |
| `Settings.coupons.channel_marketplace` | On Moto Mangos | บน Moto Mangos |
| `Settings.coupons.combining` | With other discounts | ใช้ร่วมกับส่วนลดอื่น |
| `Settings.coupons.withReturning` | Can be combined with the returning-customer discount | ใช้ร่วมกับส่วนลดลูกค้าเก่าได้ |
| `Settings.coupons.withReturningHelp` | Off: a returning customer gets whichever of the two takes more off. | ปิด: ลูกค้าเก่าจะได้ส่วนลดที่ลดได้มากกว่าระหว่างสองอย่าง |
| `Settings.coupons.withSeason` | Can be used on season discounts | ใช้กับราคาที่ลดตามฤดูกาลได้ |
| `Settings.coupons.withSeasonHelp` | Off: the coupon takes nothing off a rental that a season has already made cheaper. | ปิด: คูปองจะไม่ลดราคาการเช่าที่ลดราคาตามฤดูกาลอยู่แล้ว |
| `Settings.coupons.history.title` | History | ประวัติ |
| `Settings.coupons.history.noValue` | no discount | ไม่มีส่วนลด |
| `Settings.coupons.history.percentOff` | {percent} off | ลด {percent} |
| `Settings.coupons.history.amountOff` | {amount} off | ลด {amount} |
| `Settings.coupons.history.between` | {from} to {to} | {from} ถึง {to} |
| `Settings.coupons.history.fromDay` | from {from} | ตั้งแต่ {from} |
| `Settings.coupons.history.untilDay` | until {to} | จนถึง {to} |
| `Settings.coupons.history.anyDay` | any day | ทุกวัน |
| `Settings.coupons.history.created` | {who} created coupon {code}: {value}, all products | {who} สร้างคูปอง {code}: {value} สินค้าทั้งหมด |
| `Settings.coupons.history.createdChosen` | {who} created coupon {code}: {value}, {count, plural, one {# chosen product} other {# chosen products}} | {who} สร้างคูปอง {code}: {value} สินค้าที่เลือก {count, plural, other {#}} รายการ |
| `Settings.coupons.history.switchedOn` | {who} switched on {code} | {who} เปิด {code} |
| `Settings.coupons.history.switchedOff` | {who} switched off {code} | {who} ปิด {code} |
| `Settings.coupons.history.archived` | {who} archived {code} | {who} เก็บ {code} ถาวร |
| `Settings.coupons.history.restored` | {who} brought back {code} | {who} นำ {code} กลับมา |
| `Settings.coupons.history.allProducts` | {who} set {code} to all products | {who} ตั้ง {code} ให้ใช้กับสินค้าทั้งหมด |
| `Settings.coupons.history.chosenProducts` | {who} set {code} to {count, plural, one {# chosen product} other {# chosen products}} | {who} ตั้ง {code} ให้ใช้กับสินค้าที่เลือก {count, plural, other {#}} รายการ |
| `Settings.coupons.history.codeChanged` | {who} changed the code {from} to {to} | {who} เปลี่ยนรหัส {from} เป็น {to} |
| `Settings.coupons.history.renamed` | {who} named {code} “{name}” | {who} ตั้งชื่อ {code} ว่า “{name}” |
| `Settings.coupons.history.nameCleared` | {who} took the name off {code} | {who} ลบชื่อของ {code} |
| `Settings.coupons.history.valueChanged` | {who} changed {code} from {from} to {to} | {who} เปลี่ยน {code} จาก {from} เป็น {to} |
| `Settings.coupons.history.validDates` | {who} set the valid dates of {code}: {range} | {who} ตั้งช่วงวันที่ใช้ได้ของ {code}: {range} |
| `Settings.coupons.history.pickupDates` | {who} set the pickup dates of {code}: {range} | {who} ตั้งช่วงวันรับรถของ {code}: {range} |
| `Settings.coupons.history.minDays` | {who} set the minimum days of {code} to {days} | {who} ตั้งจำนวนวันขั้นต่ำของ {code} เป็น {days} |
| `Settings.coupons.history.minDaysCleared` | {who} took the minimum days off {code} | {who} ยกเลิกจำนวนวันขั้นต่ำของ {code} |
| `Settings.coupons.history.minSpend` | {who} set the minimum spend of {code} to {amount} | {who} ตั้งยอดขั้นต่ำของ {code} เป็น {amount} |
| `Settings.coupons.history.minSpendCleared` | {who} took the minimum spend off {code} | {who} ยกเลิกยอดขั้นต่ำของ {code} |
| `Settings.coupons.history.maxUses` | {who} set the total uses of {code} to {uses} | {who} ตั้งจำนวนครั้งที่ใช้ได้ของ {code} เป็น {uses} |
| `Settings.coupons.history.maxUsesCleared` | {who} set the total uses of {code} to no limit | {who} ตั้งจำนวนครั้งที่ใช้ได้ของ {code} เป็นไม่จำกัด |
| `Settings.coupons.history.channels` | {who} set where {code} can be used: {channels} | {who} ตั้งช่องทางที่ใช้ {code} ได้: {channels} |
| `Settings.coupons.history.channelsNone` | {who} took every channel off {code} | {who} ยกเลิกทุกช่องทางของ {code} |
| `Settings.coupons.history.channel_staff` | staff | พนักงาน |
| `Settings.coupons.history.channel_booking_page` | booking page | หน้าจอง |
| `Settings.coupons.history.channel_marketplace` | Moto Mangos | Moto Mangos |
| `Settings.coupons.history.withReturningOn` | {who} let {code} be combined with the returning-customer discount | {who} ให้ {code} ใช้ร่วมกับส่วนลดลูกค้าเก่าได้ |
| `Settings.coupons.history.withReturningOff` | {who} stopped {code} being combined with the returning-customer discount | {who} ไม่ให้ {code} ใช้ร่วมกับส่วนลดลูกค้าเก่า |
| `Settings.coupons.history.withSeasonOn` | {who} let {code} be used on season discounts | {who} ให้ {code} ใช้กับราคาที่ลดตามฤดูกาลได้ |
| `Settings.coupons.history.withSeasonOff` | {who} stopped {code} being used on season discounts | {who} ไม่ให้ {code} ใช้กับราคาที่ลดตามฤดูกาล |
| `Settings.pricing.coupons.help` | Off: no code takes anything off, on any channel. Coupons are made in Settings › Coupons. | ปิด: ไม่มีรหัสใดลดราคาได้ในทุกช่องทาง สร้างคูปองได้ที่การตั้งค่า › คูปอง |
| `Settings.pricing.returning.title` | Returning-customer discount | ส่วนลดลูกค้าเก่า |
| `Settings.pricing.returning.intro` | Taken off rentals automatically for a customer who has rented here before. Not off items for sale or services, and not stopped by the coupons switch. | หักจากค่าเช่าโดยอัตโนมัติสำหรับลูกค้าที่เคยเช่าที่ร้านมาก่อน ไม่หักจากสินค้าขายหรือบริการ และไม่ขึ้นกับสวิตช์รับคูปอง |
| `Settings.pricing.returning.label` | Give returning customers a discount | ให้ส่วนลดแก่ลูกค้าเก่า |
| `Settings.pricing.returning.percent` | Percentage off | ลดกี่เปอร์เซ็นต์ |
| `Settings.pricing.returning.percentHelp` | Such as 10 or 12.5. | เช่น 10 หรือ 12.5 |
| `Settings.pricing.returning.rentals` | Completed rentals needed | จำนวนการเช่าที่เสร็จสิ้นแล้วที่ต้องมี |
| `Settings.pricing.returning.rentalsHelp` | How many rentals at this shop make a customer “returning”. Usually 1. | ต้องเช่าที่ร้านนี้กี่ครั้งจึงนับเป็น “ลูกค้าเก่า” ปกติคือ 1 |
| `FormErrors.couponInvalidCode` | Use only the letters A to Z and the numbers 0 to 9, up to 40 of them (spaces are taken out). Thai letters and full-width characters (such as Ａ or ０) can’t be used in a code. | ใช้ได้เฉพาะตัวอักษร A ถึง Z และตัวเลข 0 ถึง 9 ไม่เกิน 40 ตัว (ระบบตัดช่องว่างออก) ใช้อักษรไทยและอักขระแบบเต็มความกว้าง (เช่น Ａ หรือ ０) ในรหัสไม่ได้ |
| `FormErrors.couponCodeTaken` | Another coupon already uses the code {code}. Archive it first, or choose another code. | มีคูปองอื่นใช้รหัส {code} อยู่แล้ว เก็บคูปองนั้นถาวรก่อน หรือเลือกรหัสอื่น |
| `FormErrors.couponCodeTakenBy` | The coupon “{name}” already uses the code {code}. Archive it first, or choose another code. | คูปอง “{name}” ใช้รหัส {code} อยู่แล้ว เก็บคูปองนั้นถาวรก่อน หรือเลือกรหัสอื่น |
| `FormErrors.couponOnlyOwnerOrManager` | Only an owner or a manager can change coupons. | เฉพาะเจ้าของหรือผู้จัดการเท่านั้นที่เปลี่ยนคูปองได้ |
| `FormErrors.couponInvalid` | Check the coupon’s details and save again. | ตรวจสอบรายละเอียดของคูปองแล้วบันทึกอีกครั้ง |
| `FormErrors.couponNotFound` | This coupon no longer exists. Reload the page. | ไม่มีคูปองนี้แล้ว โปรดโหลดหน้าใหม่ |
| `FormErrors.couponProductNotFound` | One of the chosen products no longer exists. Reload the page and choose again. | สินค้าที่เลือกบางรายการไม่มีอยู่แล้ว โปรดโหลดหน้าใหม่แล้วเลือกอีกครั้ง |
| `FormErrors.couponTryAgain` | Someone is making a booking with this coupon right now, so nothing was saved. Please save again. | มีผู้กำลังจองด้วยคูปองนี้อยู่ จึงยังไม่ได้บันทึก โปรดบันทึกอีกครั้ง |
| `FormErrors.couponPercentTooLarge` | At most 100%. | สูงสุด 100% |
| `FormErrors.couponAmountZero` | Enter an amount above 0. | กรอกจำนวนเงินมากกว่า 0 |
| `FormErrors.couponNoProducts` | Choose at least one product, or All products. | เลือกสินค้าอย่างน้อยหนึ่งรายการ หรือสินค้าทั้งหมด |
| `FormErrors.couponDatesOrder` | The last day is before the first. | วันสุดท้ายอยู่ก่อนวันแรก |
| `FormErrors.couponMinDaysRange` | Enter a whole number of days from 1 to 1,000, or leave it empty. | กรอกจำนวนวันเป็นจำนวนเต็มตั้งแต่ 1 ถึง 1,000 หรือเว้นว่างไว้ |
| `FormErrors.couponMaxUsesRange` | Enter a whole number from 1, or leave it empty for no limit. | กรอกจำนวนเต็มตั้งแต่ 1 ขึ้นไป หรือเว้นว่างไว้หากไม่จำกัด |
| `FormErrors.couponNoChannels` | Choose at least one place this code can be used. | เลือกช่องทางที่ใช้รหัสนี้ได้อย่างน้อยหนึ่งช่องทาง |
| `FormErrors.returningPercentRequired` | Enter the percentage to switch the discount on. | กรอกเปอร์เซ็นต์เพื่อเปิดส่วนลดนี้ |
| `FormErrors.returningRentalsRange` | Enter a whole number from 1 to 1,000. | กรอกจำนวนเต็มตั้งแต่ 1 ถึง 1,000 |
| `FormErrors.hold_expired` | This hold has run out; make the booking again. | การกันไว้นี้หมดเวลาแล้ว โปรดทำการจองใหม่ |
| `FormErrors.coupon_not_valid` | This coupon can’t be used right now; send it again. | ใช้คูปองนี้ไม่ได้ในขณะนี้ โปรดส่งอีกครั้ง |
| `FormErrors.coupon_used_up` | This coupon has been used as many times as it allows, so nothing was booked. Send the booking again without the code. | คูปองนี้ถูกใช้ครบจำนวนแล้ว จึงยังไม่ได้จอง โปรดส่งการจองอีกครั้งโดยไม่ใส่รหัส |
| `Pricing.check.extras` | Extras taken with it | ของเสริมที่เช่าพร้อมกัน |
| `Pricing.check.extraIncluded` | {count} included with each | รวมให้ {count} ต่อคัน |
| `Pricing.check.extraLine` | {name} × {count} | {name} × {count} |
| `Pricing.check.extraLineIncluded` | {count} of them included | รวมให้ {count} |
| `Pricing.check.coupon` | Coupon code | รหัสคูปอง |
| `Pricing.check.couponApply` | Apply | ใช้ |
| `Pricing.check.couponChecking` | Checking… | กำลังตรวจสอบ… |
| `Pricing.check.couponRemove` | Remove the code | ลบรหัส |
| `Pricing.check.returning` | Returning customer | ลูกค้าเก่า |
| `Pricing.check.returningHelp` | {percent} off rentals for a customer with {count, plural, one {# completed rental} other {# completed rentals}} here. | ลด {percent} จากค่าเช่าสำหรับลูกค้าที่เช่าที่ร้านนี้เสร็จสิ้นแล้ว {count, plural, other {#}} ครั้ง |
| `Pricing.check.returningOff` | The shop’s returning-customer discount is off (Settings › Pricing and tax). | ส่วนลดลูกค้าเก่าของร้านปิดอยู่ (การตั้งค่า › ราคาและภาษี) |
| `Pricing.check.breakdown` | Price breakdown | รายละเอียดราคา |
| `Pricing.check.discountReturning` | Returning-customer discount | ส่วนลดลูกค้าเก่า |
| `Pricing.check.discountCoupon` | Coupon {code} | คูปอง {code} |
| `Pricing.coupon.lookupFailed` | The code couldn’t be checked. Please try again. | ตรวจสอบรหัสไม่ได้ โปรดลองอีกครั้ง |
| `Pricing.coupon.applied` | Coupon {code} applied. | ใช้คูปอง {code} แล้ว |
| `Pricing.coupon.appliedInstead` | Coupon {code} applied. It can’t be combined with the returning-customer discount, and the larger discount applies: the coupon takes more off. | ใช้คูปอง {code} แล้ว คูปองนี้ใช้ร่วมกับส่วนลดลูกค้าเก่าไม่ได้ จึงใช้ส่วนลดที่มากกว่า: คูปองลดได้มากกว่า |
| `Pricing.coupon.notApplied.takesNothing` | Coupon {code} not applied: there is nothing left for it to take off. | ไม่ได้ใช้คูปอง {code}: ไม่มียอดเหลือให้ลด |
| `Pricing.coupon.notApplied.returningIsLarger` | Coupon {code} not applied: it can’t be combined with the returning-customer discount, and the larger discount applies. The returning-customer discount takes off at least as much. The code isn’t used up. | ไม่ได้ใช้คูปอง {code}: คูปองนี้ใช้ร่วมกับส่วนลดลูกค้าเก่าไม่ได้ จึงใช้ส่วนลดที่มากกว่า ส่วนลดลูกค้าเก่าลดได้เท่ากันหรือมากกว่า รหัสนี้จึงยังไม่ถูกใช้ |
| `Pricing.coupon.refused.couponsOff` | Not applied: the shop doesn’t accept coupons. Switch on “Accept coupons” in Settings › Pricing and tax. | ไม่ได้ใช้: ร้านไม่รับคูปอง เปิด “รับคูปอง” ได้ที่การตั้งค่า › ราคาและภาษี |
| `Pricing.coupon.refused.unknown` | Not applied: no coupon has this code. | ไม่ได้ใช้: ไม่มีคูปองที่ใช้รหัสนี้ |
| `Pricing.coupon.refused.notActive` | Not applied: this coupon is switched off or archived. | ไม่ได้ใช้: คูปองนี้ปิดอยู่หรือถูกเก็บถาวร |
| `Pricing.coupon.refused.wrongChannel` | Not applied: this coupon can’t be used by staff. | ไม่ได้ใช้: พนักงานใช้คูปองนี้ไม่ได้ |
| `Pricing.coupon.refused.tooEarly` | Not applied: this coupon can be used from {from}. | ไม่ได้ใช้: คูปองนี้ใช้ได้ตั้งแต่ {from} |
| `Pricing.coupon.refused.expired` | Not applied: this coupon could be used until {to}. | ไม่ได้ใช้: คูปองนี้ใช้ได้ถึง {to} |
| `Pricing.coupon.refused.usedUp` | Not applied: this coupon has been used as many times as it allows. | ไม่ได้ใช้: คูปองนี้ถูกใช้ครบจำนวนแล้ว |
| `Pricing.coupon.refused.customerUsedUp` | Not applied: this customer has used this coupon as many times as it allows. | ไม่ได้ใช้: ลูกค้ารายนี้ใช้คูปองนี้ครบจำนวนแล้ว |
| `Pricing.coupon.refused.notTheseProducts` | Not applied: this coupon isn’t for these products, or it can’t be used on a season discount. | ไม่ได้ใช้: คูปองนี้ไม่ได้ใช้กับสินค้าเหล่านี้ หรือใช้กับราคาที่ลดตามฤดูกาลไม่ได้ |
| `Pricing.coupon.refused.wrongDates` | Not applied: the pickup isn’t inside this coupon’s pickup dates. | ไม่ได้ใช้: วันรับรถไม่อยู่ในช่วงวันรับรถของคูปองนี้ |
| `Pricing.coupon.refused.wrongDatesBetween` | Not applied: the pickup must be from {from} to {to}. | ไม่ได้ใช้: ต้องรับรถระหว่าง {from} ถึง {to} |
| `Pricing.coupon.refused.wrongDatesFrom` | Not applied: the pickup must be on or after {from}. | ไม่ได้ใช้: ต้องรับรถตั้งแต่ {from} |
| `Pricing.coupon.refused.wrongDatesUntil` | Not applied: the pickup must be on or before {to}. | ไม่ได้ใช้: ต้องรับรถไม่เกิน {to} |
| `Pricing.coupon.refused.tooShort` | Not applied: the rental must be at least {days, plural, one {# day} other {# days}}. | ไม่ได้ใช้: ต้องเช่าอย่างน้อย {days, plural, other {#}} วัน |
| `Pricing.coupon.refused.belowMinimum` | Not applied: this coupon’s products must come to at least {amount} after seasonal prices. | ไม่ได้ใช้: สินค้าของคูปองนี้ต้องมียอดอย่างน้อย {amount} หลังคิดราคาตามฤดูกาล |

**After the review of PR 50 (18 Nov 2026):** new or changed lines.

| Key | English | Thai |
| --- | --- | --- |
| `FormErrors.couponInvalidAmount` | Enter an amount such as 200 or 1,234.50. Use a dot for decimals; a comma only between thousands (1,000). No spaces, and no more decimal places than the currency has. | กรอกจำนวนเงิน เช่น 200 หรือ 1,234.50 ใช้จุดสำหรับทศนิยม ใช้จุลภาคเฉพาะคั่นหลักพัน (1,000) ห้ามเว้นวรรค และทศนิยมต้องไม่เกินที่สกุลเงินนี้มี |
| `FormErrors.couponInvalidPercent` | Enter a percentage such as 10 or 12.5. Use a dot for decimals, not a comma. | กรอกเปอร์เซ็นต์ เช่น 10 หรือ 12.5 ใช้จุดสำหรับทศนิยม ไม่ใช่จุลภาค |
| `FormErrors.couponAmountTooLong` | That amount is too long: 18 digits at most. | จำนวนเงินยาวเกินไป: ไม่เกิน 18 หลัก |
| `Settings.coupons.amountHelp` | Off the coupon’s lines together, never more than they come to. Never off a deposit. Use a dot for decimals. | หักจากรายการของคูปองรวมกัน ไม่เกินยอดของรายการเหล่านั้น และไม่หักจากเงินมัดจำ ใช้จุดสำหรับทศนิยม |

## Phase 2, stage 10: review follow-ups (18 Nov 2026)

Four lines changed; none is new. Two keys are gone.

**One number rule on every screen.** The coupon form's wording for a mistyped amount or percentage (reviewed under "After the review of PR 50", above) is now the wording of the shared keys, because every screen reads numbers the same way: a dot for decimals, a comma only between thousands. The Thai text is the coupon form's, unchanged; only the keys it sits under are new. It now shows on seasons, price lists, Settings › Pricing and tax (deposit, rounding step, the returning-customer percentage), fleet costs and prices, and coupons.

**Full-width letters and numbers in a coupon code** (Ａ, ０) are now read as the plain ones, so the two code messages no longer say they can't be used.

| Key | English | Thai |
| --- | --- | --- |
| `FormErrors.invalidMoney` | Enter an amount such as 200 or 1,234.50. Use a dot for decimals; a comma only between thousands (1,000). No spaces, and no more decimal places than the currency has. | กรอกจำนวนเงิน เช่น 200 หรือ 1,234.50 ใช้จุดสำหรับทศนิยม ใช้จุลภาคเฉพาะคั่นหลักพัน (1,000) ห้ามเว้นวรรค และทศนิยมต้องไม่เกินที่สกุลเงินนี้มี |
| `FormErrors.invalidPercent` | Enter a percentage such as 10 or 12.5. Use a dot for decimals, not a comma. | กรอกเปอร์เซ็นต์ เช่น 10 หรือ 12.5 ใช้จุดสำหรับทศนิยม ไม่ใช่จุลภาค |
| `FormErrors.couponInvalidCode` | Use only the letters A to Z and the numbers 0 to 9, up to 40 of them. Spaces are taken out, and full-width letters and numbers (such as Ａ or ０) are read as A or 0. Thai letters can’t be used in a code. | ใช้ได้เฉพาะตัวอักษร A ถึง Z และตัวเลข 0 ถึง 9 ไม่เกิน 40 ตัว ระบบตัดช่องว่างออก และอ่านตัวอักษรและตัวเลขแบบเต็มความกว้าง (เช่น Ａ หรือ ０) เป็น A หรือ 0 ใช้อักษรไทยในรหัสไม่ได้ |
| `Settings.coupons.codeCantSave` | This code can’t be saved: use only the letters A to Z and the numbers 0 to 9. Thai letters can’t be used. | บันทึกรหัสนี้ไม่ได้: ใช้ได้เฉพาะตัวอักษร A ถึง Z และตัวเลข 0 ถึง 9 ใช้อักษรไทยไม่ได้ |

**Removed:** `FormErrors.couponInvalidAmount` and `FormErrors.couponInvalidPercent` (their text moved to the two shared keys above), and `Settings.coupons.usesUnknown` ("Uses: not shown (its code is used by a newer coupon)": an archived coupon now always shows its own uses).

**Before stage 10 the two shared keys read:** `FormErrors.invalidMoney` "Enter an amount, such as 45000 or 45000.50." / "กรอกจำนวนเงิน เช่น 45000 หรือ 45000.50", and `FormErrors.invalidPercent` "Enter a percentage such as 20 or 12.5." / "กรอกเปอร์เซ็นต์ เช่น 20 หรือ 12.5".

### After the review of PR 51 (19 Nov 2026)

Four lines reworded and three new. The four are the refusals on the screens where a comma or a space stopped being accepted in this stage (price lists, multipliers, buffer hours): each now says the rule, as `FormErrors.invalidMoney` already did. The three new lines are for refusals that showed the general "Couldn't save. Please try again." before: a renewal record or a week of opening hours the database refuses, and a location that has been removed since the page was loaded.

| Key | English | Thai |
| --- | --- | --- |
| `FormErrors.invalidHours` | Enter the hours as a number, like 2 or 0.5 (168 at most). Use a dot for decimals; a comma only separates thousands, so 0,5 is not read as a half. | กรอกจำนวนชั่วโมงเป็นตัวเลข เช่น 2 หรือ 0.5 (ไม่เกิน 168) ใช้จุดสำหรับทศนิยม จุลภาคใช้คั่นหลักพันเท่านั้น จึงไม่อ่าน 0,5 เป็นครึ่งชั่วโมง |
| `Pricing.quick.invalid` | Enter an amount above 0, such as 300 or 1,300.50. Use a dot for decimals; a comma only between thousands (1,000). No spaces. | กรอกราคาที่มากกว่า 0 เช่น 300 หรือ 1,300.50 ใช้จุดสำหรับทศนิยม ใช้จุลภาคเฉพาะคั่นหลักพัน (1,000) ห้ามเว้นวรรค |
| `Pricing.quick.invalidMultiplier` | Enter a multiplier above 0, such as 3 or 1.1666. Use a dot for decimals; a comma only between thousands (1,000). | กรอกตัวคูณที่มากกว่า 0 เช่น 3 หรือ 1.1666 ใช้จุดสำหรับทศนิยม ใช้จุลภาคเฉพาะคั่นหลักพัน (1,000) |
| `Pricing.grid.invalidDays` | A day typed by hand isn't a valid price. Use a dot for decimals; a comma only between thousands (1,000). No spaces. | มีวันที่แก้เองซึ่งไม่ใช่ราคาที่ถูกต้อง ใช้จุดสำหรับทศนิยม ใช้จุลภาคเฉพาะคั่นหลักพัน (1,000) ห้ามเว้นวรรค |
| `FormErrors.invalid_renewal` | This record couldn’t be saved. Check its type, its dates and its cost. | บันทึกรายการนี้ไม่ได้ กรุณาตรวจประเภท วันที่ และค่าใช้จ่าย |
| `FormErrors.invalid_hours` | These opening hours couldn’t be saved. Check each day’s times: a day closes after it opens. | บันทึกเวลาเปิดทำการไม่ได้ กรุณาตรวจเวลาของแต่ละวัน เวลาปิดต้องหลังเวลาเปิด |
| `FormErrors.location_not_found` | This location is no longer here. Reload the page. | ไม่พบสาขานี้แล้ว กรุณาโหลดหน้าใหม่ |

**Before this change the four read:** "Enter the hours as a number, like 2 or 0.5 (168 at most)." / "กรอกจำนวนชั่วโมงเป็นตัวเลข เช่น 2 หรือ 0.5 (ไม่เกิน 168)"; "Enter an amount above 0, such as 300 or 300.50." / "กรอกราคาที่มากกว่า 0 เช่น 300 หรือ 300.50"; "Enter a multiplier above 0, such as 3 or 1.1666." / "กรอกตัวคูณที่มากกว่า 0 เช่น 3 หรือ 1.1666"; "A day typed by hand isn't a valid price." / "มีวันที่แก้เองซึ่งไม่ใช่ราคาที่ถูกต้อง".

## Phase 2, stage 11: wrap-up (20 Nov 2026)

New and changed Thai lines on the branch `platform/phase-2-stage-11-wrap-up`: the New order price check (เช็กราคา), Settings › Booking rules (กฎการจอง), the Bookings section on a vehicle's page, the Moto Mangos tab's notice line, the coupon refusals for the booking page and Moto Mangos, and the gear form's line about prices. Claude's translations; please check. Words chosen: เช็กราคา (price check), กฎการจอง (booking rules), แจ้งล่วงหน้า (notice), จองเกิน (overbooking), การจองที่ขาดรถ (a shortage), กันไว้ (held), หน้าจองของร้าน (your booking page), walk-in kept in English as staff say it. Gone: `NewOrder.dates`, `NewOrder.bike`, `NewOrder.customer`, `NewOrder.extras`, `NewOrder.price`, `NewOrder.sign`, `NewOrder.pay` (the placeholder steps), `Products.general.pricesLater` (now `pricesAfterSave`).

| Key | English | Thai |
| --- | --- | --- |
| `NewOrder.title` | Price check | เช็กราคา |
| `NewOrder.intro` | See what is free and what it costs for any dates, as a booking from the counter, your booking page or Moto Mangos would. | ดูว่ามีรถว่างอะไรบ้างและราคาเท่าไรในวันที่ต้องการ แบบเดียวกับการจองจากหน้าร้าน หน้าจองของร้าน หรือ Moto Mangos |
| `NewOrder.nothingBooked` | This only checks. Nothing is booked or held, and no coupon use is counted. Making orders comes in Phase 3. | หน้านี้ใช้เช็กเท่านั้น ไม่มีการจองหรือกันรถไว้ และไม่นับการใช้คูปอง การสร้างออเดอร์จะมาในเฟส 3 |
| `NewOrder.noLocation` | Add a location first. | เพิ่มสาขาก่อน |
| `NewOrder.location` | Location | สาขา |
| `NewOrder.pickup` | Pickup | รับรถ |
| `NewOrder.return` | Return | คืนรถ |
| `NewOrder.channel` | Booked from | จองจาก |
| `NewOrder.channelHelp` | Each way of booking has its own rules: your minimum notice applies online only, and a coupon can be for some of them. | แต่ละช่องทางมีกฎของตัวเอง: การแจ้งล่วงหน้าขั้นต่ำใช้กับการจองออนไลน์เท่านั้น และคูปองอาจใช้ได้เฉพาะบางช่องทาง |
| `NewOrder.channels.walk_in` | The counter | หน้าร้าน |
| `NewOrder.channels.booking_page` | Your booking page | หน้าจองของร้าน |
| `NewOrder.channels.marketplace` | Moto Mangos | Moto Mangos |
| `NewOrder.check` | Check | เช็ก |
| `NewOrder.badDates` | The return must be after the pickup. | เวลาคืนรถต้องอยู่หลังเวลารับรถ |
| `NewOrder.noProducts` | Nothing to rent at this location yet. | สาขานี้ยังไม่มีอะไรให้เช่า |
| `NewOrder.results` | Free for these dates: {channel} | ว่างในวันที่เลือก: {channel} |
| `NewOrder.seePrice` | Price | ราคา |
| `NewOrder.priceFor` | {name}: price from {channel} | {name}: ราคาเมื่อจองจาก{channel} |
| `NewOrder.count.free` | {free} of {stock} free | ว่าง {free} จาก {stock} |
| `NewOrder.count.service` | A service: nothing to count | บริการ: ไม่ต้องนับจำนวน |
| `NewOrder.refused.tooShort` | Too short: at least {min, plural, one {# day} other {# days}} on this channel. | สั้นเกินไป: ช่องทางนี้ต้องเช่าอย่างน้อย {min, plural, other {# วัน}} |
| `NewOrder.refused.tooSoon` | Too soon: the earliest pickup on this channel is {when}. | เร็วเกินไป: ช่องทางนี้รับรถได้เร็วที่สุด {when} |
| `NewOrder.refused.closedPickup` | Closed at the pickup time. | ร้านปิดในเวลารับรถ |
| `NewOrder.refused.closedReturn` | Closed at the return time. | ร้านปิดในเวลาคืนรถ |
| `NewOrder.refused.noHours` | This location has no opening hours, so it takes no online bookings. | สาขานี้ยังไม่ได้ตั้งเวลาเปิดปิด จึงไม่รับการจองออนไลน์ |
| `NewOrder.refused.notListed` | Not listed on Moto Mangos. | ไม่ได้ลงขายบน Moto Mangos |
| `NewOrder.refused.noneFree` | None free for these dates. | ไม่มีว่างในวันที่เลือก |
| `NewOrder.refused.noneFreeShortage` | None free. Overbooking is on, so staff could still save it as a shortage. | ไม่มีว่าง แต่เปิดการจองเกินไว้ พนักงานจึงยังบันทึกเป็นการจองที่ขาดรถได้ |
| `Settings.nav.bookingRules` | Booking rules | กฎการจอง |
| `Settings.bookingRules.title` | Booking rules | กฎการจอง |
| `Settings.bookingRules.intro` | How far ahead bookings must be made, how short a rental can be, the time kept free around a rental, and how long a booking is held while someone pays. | ต้องจองล่วงหน้านานเท่าไร เช่าสั้นที่สุดได้กี่วัน เวลาที่เว้นว่างไว้ก่อนและหลังการเช่า และจะกันการจองไว้นานเท่าไรระหว่างที่ลูกค้าชำระเงิน |
| `Settings.bookingRules.shop.title` | The whole shop | ทั้งร้าน |
| `Settings.bookingRules.shop.intro` | These apply at every location. | ใช้กับทุกสาขา |
| `Settings.bookingRules.shop.overbooking` | Allow overbooking | อนุญาตให้จองเกิน |
| `Settings.bookingRules.shop.overbookingHelp` | On: when every vehicle is taken, staff can still save a booking. It is saved as a shortage, waiting for a vehicle to be assigned, and you must find one before pickup. Bookings made online are never overbooked. | เปิด: เมื่อรถถูกจองหมดแล้ว พนักงานยังบันทึกการจองได้ โดยบันทึกเป็นการจองที่ขาดรถ รอให้จัดรถให้ และคุณต้องหารถให้ได้ก่อนวันรับรถ การจองออนไลน์จะไม่มีวันจองเกิน |
| `Settings.bookingRules.shop.hold` | Hold length (minutes) | ระยะเวลากันการจอง (นาที) |
| `Settings.bookingRules.shop.holdHelp` | How long a booking keeps its vehicle while the customer pays: 5 to 60 minutes. | การจองจะกันรถไว้นานเท่าไรระหว่างที่ลูกค้าชำระเงิน: 5 ถึง 60 นาที |
| `Settings.bookingRules.shop.bufferBefore` | Time free before (hours) | เวลาว่างก่อนเช่า (ชั่วโมง) |
| `Settings.bookingRules.shop.bufferAfter` | Time free after (hours) | เวลาว่างหลังเช่า (ชั่วโมง) |
| `Settings.bookingRules.shop.bufferHelp` | For vehicles that have no time of their own. Blank is none; up to 168 hours. | ใช้กับรถที่ไม่ได้ตั้งเวลาของตัวเองไว้ เว้นว่างคือไม่มี สูงสุด 168 ชั่วโมง |
| `Settings.bookingRules.location.title` | Your location | สาขาของคุณ |
| `Settings.bookingRules.location.titleNamed` | Location: {name} | สาขา: {name} |
| `Settings.bookingRules.location.intro` | Blank is no rule. Bookings staff make in the app need no notice. | เว้นว่างคือไม่มีกฎ การจองที่พนักงานทำในแอปไม่ต้องแจ้งล่วงหน้า |
| `Settings.bookingRules.location.notice` | Minimum notice (hours) | แจ้งล่วงหน้าอย่างน้อย (ชั่วโมง) |
| `Settings.bookingRules.location.noticeHelp` | How long before pickup an online booking must be made: 0 to 720 hours. | การจองออนไลน์ต้องทำก่อนเวลารับรถนานเท่าไร: 0 ถึง 720 ชั่วโมง |
| `Settings.bookingRules.location.cutoff` | Cut-off before closing (minutes) | ปิดรับก่อนร้านปิด (นาที) |
| `Settings.bookingRules.location.cutoffHelp` | For “Ride today” on Moto Mangos: no new same-day booking this long before you close. 0 to 1,440 minutes. | สำหรับ “ขี่วันนี้” บน Moto Mangos: ไม่รับการจองวันเดียวกันใหม่ในช่วงเวลานี้ก่อนร้านปิด 0 ถึง 1,440 นาที |
| `Settings.bookingRules.location.minDaysAdvance` | Minimum days, booked ahead | จำนวนวันขั้นต่ำ จองล่วงหน้า |
| `Settings.bookingRules.location.minDaysAdvanceHelp` | The shortest rental for a booking made before the day: 1 to 365 days. | การเช่าสั้นที่สุดสำหรับการจองล่วงหน้า: 1 ถึง 365 วัน |
| `Settings.bookingRules.location.minDaysWalkin` | Minimum days, walk-in | จำนวนวันขั้นต่ำ ลูกค้า walk-in |
| `Settings.bookingRules.location.minDaysWalkinHelp` | The shortest rental for a customer at the counter, or “Ride today”: 1 to 365 days. | การเช่าสั้นที่สุดสำหรับลูกค้าที่หน้าร้าน หรือ “ขี่วันนี้”: 1 ถึง 365 วัน |
| `Settings.bookingRules.vehicles.title` | Vehicles | รถ |
| `Settings.bookingRules.vehicles.intro` | A vehicle's own minimum days, in place of its location's. Blank uses the location's rule. | จำนวนวันขั้นต่ำของรถแต่ละรุ่น ใช้แทนของสาขา เว้นว่างคือใช้กฎของสาขา |
| `Settings.bookingRules.vehicles.none` | No vehicle products yet. | ยังไม่มีสินค้าประเภทรถ |
| `Settings.bookingRules.vehicles.advance` | Booked ahead (days) | จองล่วงหน้า (วัน) |
| `Settings.bookingRules.vehicles.walkin` | Walk-in (days) | walk-in (วัน) |
| `FormErrors.bookingRulesHold` | Enter a hold length from 5 to 60 minutes. | ใส่ระยะเวลากันการจอง 5 ถึง 60 นาที |
| `FormErrors.bookingRulesNotice` | Enter whole hours from 0 to 720, or leave it blank. | ใส่จำนวนชั่วโมงเต็ม 0 ถึง 720 หรือเว้นว่าง |
| `FormErrors.bookingRulesCutoff` | Enter whole minutes from 0 to 1,440, or leave it blank. | ใส่จำนวนนาทีเต็ม 0 ถึง 1,440 หรือเว้นว่าง |
| `FormErrors.bookingRulesMinDays` | Enter whole days from 1 to 365, or leave it blank. | ใส่จำนวนวันเต็ม 1 ถึง 365 หรือเว้นว่าง |
| `FormErrors.bookingRulesOwnerOrManager` | Only an owner or a manager can change the booking rules. | เฉพาะเจ้าของหรือผู้จัดการเท่านั้นที่เปลี่ยนกฎการจองได้ |
| `FormErrors.bookingRulesInvalid` | These rules couldn't be saved as they were sent. Reload the page and try again. | บันทึกกฎเหล่านี้ไม่ได้ตามที่ส่งมา โหลดหน้าใหม่แล้วลองอีกครั้ง |
| `FormErrors.bookingRulesVehicleGone` | One of these vehicles no longer exists. Reload the page. | รถคันหนึ่งในรายการนี้ไม่มีอยู่แล้ว โหลดหน้าใหม่ |
| `FormErrors.bookingRulesTryAgain` | Someone is saving a booking right now, so nothing was saved. Please save again. | มีคนกำลังบันทึกการจองอยู่ จึงยังไม่ได้บันทึกอะไร กรุณาบันทึกอีกครั้ง |
| `Fleet.motoMangos.shopNotice` | Bookings need {hours, plural, one {# hour} other {# hours}}: your shop's minimum notice. | การจองต้องแจ้งล่วงหน้า {hours, plural, other {# ชั่วโมง}}: ตามการแจ้งล่วงหน้าขั้นต่ำของร้าน |
| `Fleet.bookings.title` | Bookings | การจอง |
| `Fleet.bookings.intro` | The bookings this vehicle is set aside for. Times are {zone} time. Bookings are made and changed from orders, which come in Phase 3. | การจองที่กันรถคันนี้ไว้ เวลาเป็นเวลา {zone} การสร้างและแก้ไขการจองทำจากออเดอร์ ซึ่งจะมาในเฟส 3 |
| `Fleet.bookings.none` | No bookings now or coming up. | ไม่มีการจองตอนนี้หรือที่จะมาถึง |
| `Fleet.bookings.range` | {from} to {to} | {from} ถึง {to} |
| `Fleet.bookings.held` | Held until {until}, while the customer pays | กันไว้ถึง {until} ระหว่างที่ลูกค้าชำระเงิน |
| `Fleet.bookings.heldNoEnd` | Held while the customer pays | กันไว้ระหว่างที่ลูกค้าชำระเงิน |
| `Fleet.bookings.booked` | Booked | จองแล้ว |
| `Fleet.bookings.out` | Out with the customer | อยู่กับลูกค้า |
| `Fleet.bookings.overdue` | Out and overdue: still blocked until it comes back | ยังไม่คืนและเลยกำหนด: ยังกันไว้จนกว่าจะคืน |
| `Fleet.bookings.returned` | Returned | คืนแล้ว |
| `Fleet.bookings.past` | Earlier bookings | การจองก่อนหน้า |
| `Products.general.pricesAfterSave` | Once it is saved, set its price on its Pricing tab. Selling items comes with orders. | เมื่อบันทึกแล้ว ตั้งราคาได้ที่แท็บราคาของสินค้านี้ ส่วนการขายสินค้าจะมาพร้อมระบบออเดอร์ |
| `Pricing.coupon.refused.wrongChannelBookingPage` | Not applied: this coupon can’t be used on your booking page. | ไม่ได้ใช้: ใช้คูปองนี้ในหน้าจองของร้านไม่ได้ |
| `Pricing.coupon.refused.wrongChannelMarketplace` | Not applied: this coupon can’t be used on Moto Mangos. | ไม่ได้ใช้: ใช้คูปองนี้บน Moto Mangos ไม่ได้ |
| `NewOrder.refused.capReached` | Moto Mangos has used all the units you list there for these dates. | Moto Mangos ใช้จำนวนรถที่คุณลงขายไว้ครบแล้วในวันที่เลือก |
