package com.dto;

import com.entity.Issue;
import lombok.Data;

import java.time.LocalDateTime;

// DTO returned by the Confirm Portal's paged endpoint. Mirrors the fields
// ConfirmPortal.jsx actually reads (table columns + ViewDrawer). Keeping a
// DTO instead of returning the raw entity means we control exactly what
// goes over the wire, and can stamp a computed reqId onto documents that
// don't have a persisted one yet without mutating the entity.
@Data
public class IssueConfirmDto {

    private Long id;
    private String reqId;
    private String fileNumber;

    private String customerName;
    private String jobType;
    private String jobwbs;
    private String reservationNo;
    private String requestDate;
    private String requestTime;
    private String requestedBy;
    private String vehicleNo;
    private String enteredBy;
    private LocalDateTime createdDatetime;
    private String divisionNo;

    // Print
    private String printStatus;
    private String printDocumentNo;
    private String printedBy;
    private LocalDateTime printStartTime;
    private LocalDateTime printEndTime;
    private LocalDateTime printHandoverTime;
    private String PrintHandedOverBy;
    private String printHoldReason;
    private String printHeldBy;
    private LocalDateTime printHoldTime;
    private LocalDateTime printResumeTime;

    // Pick
    private String pickedBy;
    private LocalDateTime startTime;
    private LocalDateTime endTime;
    private String holdReason;
    private String heldBy;
    private LocalDateTime holdTime;
    private LocalDateTime resumeTime;
    private Boolean emergencyPickResolved;
    private String emergencyPickResolvedBy;
    private LocalDateTime emergencyResolvedTime;

    // Check
    private String checkedBy;
    private LocalDateTime checkStartTime;
    private LocalDateTime checkEndTime;
    private String checkHoldReason;
    private String checkHeldBy;
    private LocalDateTime checkHoldTime;
    private LocalDateTime checkResumeTime;
    private String hasWrongMaterial;
    private String wrongMaterialSku;
    private String wrongMaterialQty;

    // Delivery
    private String deliveryStatus;
    private LocalDateTime deliveryStartTime;
    private LocalDateTime deliveryEndTime;
    private String deliveredBy;
    private String deliveryVehicleNo;
    private Boolean deliveryConfirmed;
    private String deliveryConfirmedBy;
    private LocalDateTime deliveryConfirmTime;

    // Cancel
    private String deliveryCancelReason;
    private String deliveryCancelledBy;
    private LocalDateTime deliveryCancelTime;
    private Boolean cancelConfirmed;
    private String cancelConfirmedBy;
    private LocalDateTime cancelConfirmTime;

    // fallbackReqId: used only when the entity doesn't already have a
    // persisted reqId (e.g. hasn't been Added to File yet).
    public static IssueConfirmDto from(Issue i, String fallbackReqId) {
        IssueConfirmDto d = new IssueConfirmDto();

        d.setId(i.getId());
        d.setReqId(i.getReqId() != null && !i.getReqId().isBlank() ? i.getReqId() : fallbackReqId);
        d.setFileNumber(i.getFileNumber());

        d.setCustomerName(i.getCustomerName());
        d.setJobType(i.getJobType());
        d.setJobwbs(i.getJobwbs());
        d.setReservationNo(i.getReservationNo());
        d.setRequestDate(i.getRequestDate());
        d.setRequestTime(i.getRequestTime());
        d.setRequestedBy(i.getRequestedBy());
        d.setVehicleNo(i.getVehicleNo());
        d.setEnteredBy(i.getEnteredBy());
        d.setCreatedDatetime(i.getCreatedDatetime());
        d.setDivisionNo(i.getDivisionNo());

        d.setPrintStatus(i.getPrintStatus());
        d.setPrintDocumentNo(i.getPrintDocumentNo());
        d.setPrintedBy(i.getPrintedBy());
        d.setPrintStartTime(i.getPrintStartTime());
        d.setPrintEndTime(i.getPrintEndTime());
        d.setPrintHandoverTime(i.getPrintHandoverTime());
        d.setPrintHandedOverBy(i.getPrintHandedOverBy());
        d.setPrintHoldReason(i.getPrintHoldReason());
        d.setPrintHeldBy(i.getPrintHeldBy());
        d.setPrintHoldTime(i.getPrintHoldTime());
        d.setPrintResumeTime(i.getPrintResumeTime());

        d.setPickedBy(i.getPickedBy());
        d.setStartTime(i.getStartTime());
        d.setEndTime(i.getEndTime());
        d.setHoldReason(i.getHoldReason());
        d.setHeldBy(i.getHeldBy());
        d.setHoldTime(i.getHoldTime());
        d.setResumeTime(i.getResumeTime());
        d.setEmergencyPickResolved(i.getEmergencyPickResolved());
        d.setEmergencyPickResolvedBy(i.getEmergencyPickResolvedBy());
        d.setEmergencyResolvedTime(i.getEmergencyResolvedTime());

        d.setCheckedBy(i.getCheckedBy());
        d.setCheckStartTime(i.getCheckStartTime());
        d.setCheckEndTime(i.getCheckEndTime());
        d.setCheckHoldReason(i.getCheckHoldReason());
        d.setCheckHeldBy(i.getCheckHeldBy());
        d.setCheckHoldTime(i.getCheckHoldTime());
        d.setCheckResumeTime(i.getCheckResumeTime());
        d.setHasWrongMaterial(i.getHasWrongMaterial());
        d.setWrongMaterialSku(i.getWrongMaterialSku());
        d.setWrongMaterialQty(i.getWrongMaterialQty());

        d.setDeliveryStatus(i.getDeliveryStatus());
        d.setDeliveryStartTime(i.getDeliveryStartTime());
        d.setDeliveryEndTime(i.getDeliveryEndTime());
        d.setDeliveredBy(i.getDeliveredBy());
        d.setDeliveryVehicleNo(i.getDeliveryVehicleNo());
        d.setDeliveryConfirmed(i.getDeliveryConfirmed());
        d.setDeliveryConfirmedBy(i.getDeliveryConfirmedBy());
        d.setDeliveryConfirmTime(i.getDeliveryConfirmTime());

        d.setDeliveryCancelReason(i.getDeliveryCancelReason());
        d.setDeliveryCancelledBy(i.getDeliveryCancelledBy());
        d.setDeliveryCancelTime(i.getDeliveryCancelTime());
        d.setCancelConfirmed(i.getCancelConfirmed());
        d.setCancelConfirmedBy(i.getCancelConfirmedBy());
        d.setCancelConfirmTime(i.getCancelConfirmTime());

        return d;
    }
}