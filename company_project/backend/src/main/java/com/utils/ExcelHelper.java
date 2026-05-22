package com.utils;

import com.entity.Document;

import org.apache.poi.ss.usermodel.*;
import org.apache.poi.xssf.usermodel.XSSFWorkbook;

import java.io.InputStream;
import java.time.LocalDate;
import java.time.LocalTime;
import java.util.ArrayList;
import java.util.List;

public class ExcelHelper {

    public static List<Document> excelToDocuments(InputStream is) {

        try {

            Workbook workbook = new XSSFWorkbook(is);

            Sheet sheet = workbook.getSheetAt(0);

            List<Document> docs = new ArrayList<>();

            for (Row row : sheet) {

                // Skip Header Row
                if (row.getRowNum() == 0) {
                    continue;
                }

                Document doc = new Document();

                doc.setJobType(
                    row.getCell(0).getStringCellValue()
                );

                doc.setJobWBS(
                    row.getCell(1).getStringCellValue()
                );

                doc.setReservationNo(
                    row.getCell(2).getStringCellValue()
                );

                doc.setCustomerName(
                    row.getCell(3).getStringCellValue()
                );

                doc.setEnteredBy(
                    row.getCell(4).getStringCellValue()
                );

                // AUTO VALUES
                doc.setRequestDate(LocalDate.now().toString());

                doc.setRequestTime(LocalTime.now().toString());

                doc.setStatus("Print Pending");

                docs.add(doc);
            }

            workbook.close();

            return docs;

        } catch (Exception e) {

            throw new RuntimeException(
                "Excel parsing failed: " + e.getMessage()
            );
        }
    }
}